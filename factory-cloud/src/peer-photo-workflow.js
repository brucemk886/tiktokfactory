import { buildPhotoStoryPrompt, buildStockPickPrompt, parsePhotoStory, parseStockPick } from '../../scripts/psychology-peer-production.js';
import { createKieClient } from './kie.js';
import { searchStockPhotos } from './photo-publishing.js';
import { preparePeerPhotosForKie, deletePeerPhotoSources } from './peer-photo-convert.js';
import { resolveTikTokPhotoSource } from './tikhub-photo-source.js';
import { withProductionPatch, compactProduction } from '../../scripts/production-timeline.js';

// Paid submissions are never blindly retried after an ambiguous provider error.
const SUBMIT = { retries: { limit: 0, delay: '1 second' }, timeout: '2 minutes' };
const READ = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' };
const CONVERT = { retries: { limit: 1, delay: '3 seconds' }, timeout: '3 minutes' };

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
  let kiePhotos = { urls: [], keys: [] };
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
    await save('converting', 'running', 6, `已获取原帖 ${total} 张图片，正在转成 Gemini 可识别的 JPEG/PNG/WebP…`, '', {productionStage:'script'});
    kiePhotos = await step.do('prepare-kie-images', CONVERT, () => preparePeerPhotosForKie(env, id, source.urls));
    const rewrite = payload.rewriteCopy !== false;
    await save('source-ready', 'running', 8, `原图已转码，Gemini 3.8 Flash 正在逐张判断文案卡片或素材底图${rewrite ? '并改写文案' : '并提取原文'}…`, '', {productionStage:'script'});
    let validationError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const text = await step.do(`story-${attempt}`, SUBMIT, () => kie.createChat(
        buildPhotoStoryPrompt(payload, { sceneCount: total }) + (validationError ? `\nCorrect this validation error: ${validationError}` : ''),
        { model: 'gemini-3-8-flash', imageUrls: kiePhotos.urls }
      ));
      try { plan = parsePhotoStory(text, { sceneCount: total }); break; } catch (error) { validationError = error.message; }
    }
    if (!plan) throw new Error(validationError);
    await save('story-ready', 'running', 15, `${total} 页已分类，开始匹配文案模板或素材库底图…`, '', {productionStage:'images'});
    for (let index = 0; index < plan.scenes.length; index++) {
      const scene = plan.scenes[index];
      if (scene.template === 'stock') {
        await save(`image-${index}-starting`, 'running', progress(total, results.length), `正在为第 ${index+1}/${total} 页搜索相近底图…`, '', {productionScene:{index,text:scene.text,imagePrompt:scene.stockQuery,imageStatus:'running'}});
        const photo = await matchStockPhoto(env, kie, step, scene, kiePhotos.urls[index], index);
        results.push(photoPage(scene, index, photo));
        await save(`image-${index}-saved`, 'running', progress(total, results.length), `云端已完成 ${results.length}/${total} 页。`, '', {productionScene:{index,imageUrl:photo.fileUrl || photo.imageUrl,imagePrompt:scene.stockQuery,imageStatus:'done'}});
      } else {
        results.push(textPage(scene, index));
        await save(`image-${index}-saved`, 'running', progress(total, results.length), `第 ${index+1}/${total} 页走文案卡片。`, '', {productionScene:{index,text:scene.text,imagePrompt:'',imageStatus:'done'}});
      }
    }
    await save('completed', 'done', 100, `已按原帖顺序完成 ${total} 页：文案卡片或素材库底图，不经过 AI 生图。`);
    return { jobId: id, count: results.length };
  } catch (error) {
    await save('failed', 'failed', progress(total, results.length), '图文复刻失败，已保留完成的页面。', String(error.message || error).slice(0, 1000));
    throw error;
  } finally {
    if (kiePhotos.keys.length) {
      await step.do('delete-kie-photos', READ, () => deletePeerPhotoSources(env, kiePhotos.keys)).catch(() => {});
    }
  }
}

async function matchStockPhoto(env, kie, step, scene, sourceUrl, index) {
  const found = await step.do(`stock-search-${index}`, READ, () => searchStockPhotos(env, new URLSearchParams({ q: scene.stockQuery, count: '8' })));
  if (!found.configured) throw new Error('还没有配置 Pexels，无法为有底图的页面匹配素材。');
  let photos = found.photos || [];
  if (!photos.length) {
    const fallback = await step.do(`stock-search-fallback-${index}`, READ, () => searchStockPhotos(env, new URLSearchParams({
      q: 'cinematic empty landscape fog forest interior hallway',
      count: '8'
    })));
    photos = fallback.photos || [];
  }
  if (!photos.length) throw new Error(`第 ${index + 1} 页没有搜到相近素材。`);
  const candidates = photos.slice(0, 4);
  if (candidates.length === 1 || !/^https:\/\//i.test(String(sourceUrl || ''))) return candidates[0];
  try {
    const text = await step.do(`stock-pick-${index}`, SUBMIT, () => kie.createChat(buildStockPickPrompt(scene, candidates), {
      model: 'gemini-3-8-flash',
      imageUrls: [sourceUrl, ...candidates.map((photo) => photo.imageUrl)].filter((url) => /^https:\/\//i.test(url)).slice(0, 6)
    }));
    return candidates[parseStockPick(text, candidates.length)];
  } catch {
    return candidates[0];
  }
}

function textPage(scene, index) {
  return {
    sceneIndex: index,
    sourceIndex: scene.sourceIndex,
    template: scene.textKind === 'cover' ? 'cover' : 'content',
    textKind: scene.textKind,
    title: scene.title,
    subtitle: scene.subtitle,
    body: scene.body,
    text: scene.text,
    originalText: scene.originalText,
    stockQuery: '',
    imageUrl: '',
    fileUrl: '',
    imageModel: 'text-card',
  };
}

function photoPage(scene, index, photo) {
  return {
    sceneIndex: index,
    sourceIndex: scene.sourceIndex,
    template: 'stock',
    textKind: 'stock',
    title: scene.title,
    subtitle: scene.subtitle,
    body: scene.body,
    text: scene.text,
    originalText: scene.originalText,
    stockQuery: scene.stockQuery,
    imageUrl: photo.imageUrl,
    fileUrl: photo.fileUrl,
    thumbUrl: photo.thumbUrl,
    author: photo.author,
    imageModel: 'stock',
  };
}

function progress(total, completed) {
  return Math.min(95, Math.round(15 + (Math.max(0, completed) * 80) / Math.max(1, total)));
}
