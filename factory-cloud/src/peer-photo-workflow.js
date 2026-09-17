import { buildPhotoStoryPrompt, parsePhotoStory } from '../../scripts/psychology-peer-production.js';
import { createKieClient } from './kie.js';
import { resolveTikTokPhotoSource } from './tikhub-photo-source.js';
import { withProductionPatch, compactProduction } from '../../scripts/production-timeline.js';

// Paid submissions are never blindly retried after an ambiguous provider error.
const SUBMIT = { retries: { limit: 0, delay: '1 second' }, timeout: '2 minutes' };
const READ = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' };

export async function runPeerPhotoWorkflow(env, event, step) {
  const id = event.payload.jobId;
  const row = await step.do('load-source', READ, () => env.DB.prepare("SELECT * FROM factory_jobs WHERE id = ? AND type = 'psychology-photo-story'").bind(id).first());
  if (!row || ['done', 'failed', 'canceled', 'cancelled'].includes(row.status)) return { skipped: true };
  const payload = JSON.parse(row.payload_json);
  const kie = createKieClient({ apiKey: env.KIE_API_KEY, fetchImpl: env.fetch || fetch });
  let plan = null;
  const results = [];
  let total = 0;
  let state = {};
  async function save(name, status, percent, message, error = '', patch = {}) {
    const at = await step.do(`${name}-time`, () => Date.now());
    state = withProductionPatch(state, {status,message,...patch}, at);
    await step.do(name, READ, () => env.DB.prepare(`UPDATE factory_jobs SET status=?, percent=?, message=?, result_json=?, error=?, worker_id='cloud-photo', updated_at=?, completed_at=? WHERE id=?`)
      .bind(status, percent, message, JSON.stringify({ plan, results, production:compactProduction(state.production), execution: 'cloud', analysisModel: 'gemini-3-8-flash', progressCurrent: results.length, progressTotal: total }), error, at, ['done','failed'].includes(status) ? at : 0, id).run());
  }
  try {
    await save('starting', 'running', 3, '云端正在获取原帖全部图片…', '', {productionStage:'script'});
    const source = await step.do('resolve-source-images', READ, () => resolveTikTokPhotoSource(env, {
      url: payload.peerSource?.videoUrl,
      imageUrls: payload.peerSource?.imageUrls
    }));
    total = source.urls.length;
    payload.sceneCount = total;
    if (!payload.script && source.sourceCopy) payload.script = source.sourceCopy.slice(0, 5000);
    await save('source-ready', 'running', 8, `已获取原帖 ${total} 张图片，Gemini 3.8 Flash 正在逐张分析并改写文案…`, '', {productionStage:'script'});
    let validationError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const text = await step.do(`story-${attempt}`, SUBMIT, () => kie.createChat(
        buildPhotoStoryPrompt(payload, { sceneCount: total }) + (validationError ? `\nCorrect this validation error: ${validationError}` : ''),
        { model: 'gemini-3-8-flash', imageUrls: source.urls }
      ));
      try { plan = parsePhotoStory(text, { sceneCount: total }); break; } catch (error) { validationError = error.message; }
    }
    if (!plan) throw new Error(validationError);
    await save('story-ready', 'running', 15, `${total} 页改写文案和分镜已完成，云端开始生图…`, '', {productionStage:'images'});
    for (let index = 0; index < plan.scenes.length; index++) {
      const scene = plan.scenes[index];
      await save(`image-${index}-starting`, 'running', progress(total, results.length), `云端正在生成第 ${index+1}/${total} 页…`, '', {productionScene:{index,text:scene.text,imagePrompt:scene.visualPrompt,imageStatus:'running'}});
      const task = await step.do(`image-${index}-submit`, SUBMIT, () => kie.createKieMediaTask('image', scene.visualPrompt, { imageModel: 'z-image', aspectRatio: '9:16', noImageText: true }));
      let remote;
      for (let poll = 0; poll < 60; poll++) {
        remote = await step.do(`image-${index}-poll-${poll}`, READ, () => kie.getKieTask(task.taskId));
        if (['success', 'fail'].includes(remote.state)) break;
        await step.sleep(`image-${index}-wait-${poll}`, '10 seconds');
      }
      if (remote?.state !== 'success' || !remote.resultUrls?.[0]?.startsWith('https://')) {
        throw new Error(remote?.error || `第 ${index + 1} 页生图失败或超时，已保留已完成的内容。`);
      }
      results.push({ title: scene.text, imageUrl: remote.resultUrls[0], imageModel: 'z-image', template: 'psychology-photo-story', sceneIndex: index, sourceIndex: index + 1, visualPrompt: scene.visualPrompt });
      await save(`image-${index}-saved`, 'running', progress(total, results.length), `云端已完成 ${results.length}/${total} 页图片。`, '', {productionScene:{index,imageUrl:remote.resultUrls[0],imageStatus:'done'}});
    }
    await save('completed', 'done', 100, `云端已按原帖顺序生成 ${total} 张新图片和对应文案。`);
    return { jobId: id, count: results.length };
  } catch (error) {
    await save('failed', 'failed', progress(total, results.length), '图文生成失败，已保留完成的分镜和图片。', String(error.message || error).slice(0, 1000));
    throw error;
  }
}

function progress(total, completed) {
  return Math.min(95, Math.round(15 + (Math.max(0, completed) * 80) / Math.max(1, total)));
}
