import { runGeminiVideoWorkflow } from './gemini-video-workflow.js';
import { createKieClient } from './kie.js';
import { buildRecreationAnalysisPrompt, parseRecreationPlan } from '../../scripts/psychology-recreation.js';

const READ = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' };
const DOWNLOAD = { retries: { limit: 1, delay: '15 seconds' }, timeout: '15 minutes' };
const PAID_SUBMIT = { retries: { limit: 0, delay: '1 second' }, timeout: '2 minutes' };
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function runPsychologyRecreationWorkflow(env, event, step) {
  const id = event.payload.jobId;
  const row = await step.do('load-job', READ, () => env.DB.prepare(
    "SELECT * FROM factory_jobs WHERE id=? AND type='psychology-recreation'"
  ).bind(id).first());
  if (!row || ['done', 'failed', 'canceled', 'cancelled'].includes(row.status)) return { skipped: true };

  const payload = JSON.parse(row.payload_json || '{}');
  const sourceKey = `psychology-recreation-sources/${id}/source.mp4`;
  const analysisId = `recreation-${id}`;
  const scenes = [];
  const failures = [];
  let plan = null;
  let analysis = null;

  async function save(name, status, percent, message, error = '') {
    const stamp = await step.do(`${name}-time`, () => Date.now());
    const result = {
      plan,
      scenes,
      analysis,
      execution: 'cloud',
      materialStatus: status === 'done' ? 'ready-for-review' : status === 'failed' ? 'partial' : 'generating',
      sourceDeleted: status === 'done' || status === 'failed'
    };
    await step.do(name, READ, () => env.DB.prepare(`UPDATE factory_jobs
      SET status=?,percent=?,message=?,result_json=?,error=?,worker_id='cloud-recreation',updated_at=?,completed_at=?
      WHERE id=?`).bind(
      status, percent, message, JSON.stringify(result), error, stamp,
      ['done', 'failed'].includes(status) ? stamp : 0, id
    ).run());
  }

  try {
    await save('mark-downloading', 'running', 5, '正在下载 TikTok 原视频…');
    const downloaded = await step.do('download-tiktok-video', DOWNLOAD, () => downloadTikTokToR2(env, {
      url: payload.peerSource.videoUrl,
      videoFileUrl: payload.peerSource.videoFileUrl,
      r2Key: sourceKey,
      jobId: id
    }));
    await save('mark-analyzing', 'running', 18, '原视频已临时保存，正在分析镜头、画面和口播…');

    const stamp = await step.do('analysis-created-time', () => Date.now());
    await step.do('create-analysis-row', READ, () => env.DB.prepare(`INSERT INTO factory_video_analyses (
      id,owner_username,model,file_name,mime_type,file_size,prompt,status,progress,result_text,error,r2_key,
      google_file_name,input_tokens,output_tokens,provider,provider_credits,created_at,updated_at,completed_at
    ) VALUES (?,?,?,?,?,?,?,'queued',5,'','',?,'',0,0,'google',0,?,?,0)
    ON CONFLICT(id) DO UPDATE SET file_size=excluded.file_size,prompt=excluded.prompt,status='queued',progress=5,
      result_text='',error='',r2_key=excluded.r2_key,google_file_name='',input_tokens=0,output_tokens=0,
      provider='google',provider_credits=0,updated_at=excluded.updated_at,completed_at=0`).bind(
      analysisId, row.created_by, 'gemini-3.8-flash', 'source.mp4', 'video/mp4', downloaded.size,
      buildRecreationAnalysisPrompt(payload), sourceKey, stamp, stamp
    ).run());

    await runGeminiVideoWorkflow(env, { payload: { analysisId } }, prefixedStep(step, 'video'));
    const analyzed = await step.do('load-analysis-result', READ, () => env.DB.prepare(
      "SELECT status,result_text,error,provider,provider_credits,input_tokens,output_tokens FROM factory_video_analyses WHERE id=?"
    ).bind(analysisId).first());
    if (!analyzed || analyzed.status !== 'success') throw new Error(analyzed?.error || '视频分析没有完成。');
    plan = parseRecreationPlan(analyzed.result_text, { durationSeconds: payload.peerSource.durationSeconds });
    analysis = {
      provider: String(analyzed.provider || 'google'),
      creditsConsumed: Number(analyzed.provider_credits || 0),
      inputTokens: Number(analyzed.input_tokens || 0),
      outputTokens: Number(analyzed.output_tokens || 0)
    };
    for (const scene of plan.scenes) scenes.push({
      ...scene,
      imageStatus: 'queued',
      audioStatus: 'queued',
      imageUrl: '',
      audioUrl: '',
      audioDuration: 0
    });
    await save('save-storyboard', 'running', 35, `视频已拆成 ${scenes.length} 个分镜，正在生成图片和配音…`);

    const kie = createKieClient({ apiKey: env.KIE_API_KEY, fetchImpl: env.fetch || fetch });
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      const baseProgress = 35 + Math.floor((index / scenes.length) * 58);
      scene.imageStatus = 'running';
      scene.audioStatus = 'running';
      await save(`scene-${index}-start`, 'running', baseProgress, `正在生成第 ${index + 1}/${scenes.length} 个分镜的图片和配音…`);

      try {
        const task = await step.do(`scene-${index}-image-submit`, PAID_SUBMIT, () => kie.createKieMediaTask(
          'image',
          `${plan.creativeDirection}\n\n${scene.visualPrompt}\n\nVertical 9:16 composition. No text, subtitles, logos, interface elements, or watermark.`,
          { imageModel: 'z-image', aspectRatio: '9:16', noImageText: true }
        ));
        let remote = null;
        for (let poll = 0; poll < 48; poll += 1) {
          remote = await step.do(`scene-${index}-image-poll-${poll}`, READ, () => kie.getKieTask(task.taskId));
          if (['success', 'fail'].includes(remote.state)) break;
          await step.sleep(`scene-${index}-image-wait-${poll}`, '10 seconds');
        }
        if (remote?.state !== 'success' || !/^https:\/\//i.test(remote.resultUrls?.[0] || '')) {
          throw new Error(remote?.error || '生图失败或超时。');
        }
        const image = await step.do(`scene-${index}-image-archive`, READ, () => archiveRemoteImage(
          env, remote.resultUrls[0], `psychology-recreation/${id}/scene-${index}.image`
        ));
        scene.imageStatus = 'done';
        scene.imageUrl = assetUrl(id, 'image', index);
        scene.imageSize = image.size;
        await save(`scene-${index}-image-saved`, 'running', baseProgress + 2, `第 ${index + 1} 个分镜图片已完成，正在配音…`);
      } catch (error) {
        scene.imageStatus = 'failed';
        scene.imageError = String(error?.message || error).slice(0, 500);
        failures.push(`分镜 ${index + 1} 生图：${scene.imageError}`);
        await save(`scene-${index}-image-failed`, 'running', baseProgress + 2, `第 ${index + 1} 个分镜生图失败，继续生成其余素材。`);
      }

      try {
        const audio = await step.do(`scene-${index}-audio-submit`, PAID_SUBMIT, () => createSceneAudio(env, {
          voiceId: payload.voiceId,
          text: scene.narration,
          r2Key: `psychology-recreation/${id}/scene-${index}.mp3`,
          sceneIndex: index,
          jobId: id
        }));
        scene.audioStatus = 'done';
        scene.audioUrl = assetUrl(id, 'audio', index);
        scene.audioDuration = audio.duration;
        scene.audioSize = audio.size;
      } catch (error) {
        scene.audioStatus = 'failed';
        scene.audioError = String(error?.message || error).slice(0, 500);
        failures.push(`分镜 ${index + 1} 配音：${scene.audioError}`);
      }
      await save(`scene-${index}-complete`, 'running', baseProgress + 5, `第 ${index + 1}/${scenes.length} 个分镜素材已处理。`);
    }

    if (failures.length) throw new Error(`部分素材生成失败：${failures.slice(0, 6).join('；')}`);
    await save('complete', 'done', 100, '分镜、图片和配音已就绪，请检查后再合成。');
    return { jobId: id, scenes: scenes.length, provider: analysis.provider };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1500);
    await save('fail', 'failed', Math.max(5, plan ? 40 : 12), '复刻素材生成未全部完成，已保留可用结果。', message);
    throw error;
  } finally {
    await step.do('delete-source-video', READ, () => env.ARCHIVE.delete(sourceKey).catch(() => null));
    await step.do('delete-analysis-row', READ, () => env.DB.prepare(
      'DELETE FROM factory_video_analyses WHERE id=?'
    ).bind(analysisId).run().catch(() => null));
  }
}

function prefixedStep(step, prefix) {
  return {
    do(name, options, run) {
      return typeof options === 'function'
        ? step.do(`${prefix}-${name}`, options)
        : step.do(`${prefix}-${name}`, options, run);
    },
    sleep(name, duration) {
      return step.sleep(`${prefix}-${name}`, duration);
    }
  };
}

export function validateTikTokVideoFileUrl(value) {
  if (!String(value || '').trim()) {
    throw Object.assign(new Error('此记录只有 TikTok 网页链接，尚未获取可下载的视频文件地址。'), { statusCode: 422 });
  }
  let parsed;
  try { parsed = new URL(value); } catch {
    throw Object.assign(new Error('TikTok 视频文件地址无效。'), { statusCode: 400 });
  }
  const domains = ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com'];
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
      !domains.some(domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) {
    throw Object.assign(new Error('只支持 TikTok CDN 的 HTTPS 视频文件地址。'), { statusCode: 400 });
  }
  return parsed.href;
}

export async function downloadTikTokToR2(env, { url, videoFileUrl, r2Key, jobId }) {
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
      !['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(parsed.hostname)) {
    throw Object.assign(new Error('只支持公开的 TikTok 视频链接。'), { statusCode: 400 });
  }
  const directUrl = validateTikTokVideoFileUrl(videoFileUrl);
  const response = await (env.fetch || fetch)(directUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok || !response.body) throw new Error(`TikTok 视频下载失败：HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['video/mp4', 'video/x-m4v', 'application/octet-stream'].includes(contentType)) {
    throw new Error('TikTok 视频下载内容无效：返回的不是视频文件。');
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_VIDEO_BYTES) throw new Error('TikTok 原视频超过 300 MB。');
  const stored = await env.ARCHIVE.put(r2Key, response.body, {
    httpMetadata: { contentType: 'video/mp4' },
    customMetadata: { kind: 'psychology-recreation-source', jobId: String(jobId) }
  });
  const size = Number(stored?.size || declared || 0);
  if (size < 1024 || size > MAX_VIDEO_BYTES) {
    await env.ARCHIVE.delete(r2Key);
    throw new Error(size > MAX_VIDEO_BYTES ? 'TikTok 原视频超过 300 MB。' : 'TikTok 视频下载内容无效。');
  }
  return { size, mimeType: 'video/mp4' };
}

async function archiveRemoteImage(env, url, key) {
  const response = await (env.fetch || fetch)(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok || !response.body) throw new Error(`读取生成图片失败：HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error('生成图片超过 20 MB。');
  const contentType = String(response.headers.get('content-type') || 'image/webp').split(';')[0];
  if (!contentType.startsWith('image/')) throw new Error('生图服务返回的不是图片。');
  const stored = await env.ARCHIVE.put(key, response.body, { httpMetadata: { contentType } });
  const size = Number(stored?.size || declared || 0);
  if (size < 100 || size > MAX_IMAGE_BYTES) {
    await env.ARCHIVE.delete(key);
    throw new Error('生成图片文件无效。');
  }
  return { size, contentType };
}

async function createSceneAudio(env, { voiceId, text, r2Key, sceneIndex, jobId }) {
  const key = String(env.ELEVENLABS_API_KEY || '').trim();
  if (!key) throw new Error('ElevenLabs API Key 未配置。');
  const response = await (env.fetch || fetch)(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
      signal: AbortSignal.timeout(120000)
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ElevenLabs 配音失败：${data?.detail?.message || data?.detail || data?.message || response.status}`);
  const encoded = String(data.audio_base64 || '');
  const bytes = base64Bytes(encoded);
  if (bytes.byteLength < 1024) throw new Error('ElevenLabs 返回的配音无效。');
  await env.ARCHIVE.put(r2Key, bytes, {
    httpMetadata: { contentType: 'audio/mpeg' },
    customMetadata: { kind: 'psychology-recreation-audio', jobId: String(jobId), sceneIndex: String(sceneIndex) }
  });
  const ends = data.normalized_alignment?.character_end_times_seconds || data.alignment?.character_end_times_seconds || [];
  const duration = Math.max(0, Number(ends.at?.(-1) || ends[ends.length - 1] || 0));
  return { size: bytes.byteLength, duration: Math.round(duration * 1000) / 1000 };
}

function base64Bytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function assetUrl(jobId, kind, index) {
  return `/api/psychology-peer-hits/production/${encodeURIComponent(jobId)}/assets/${kind}/${index}`;
}
