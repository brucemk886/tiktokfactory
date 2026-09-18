import { buildPhotoStoryPrompt, parsePhotoStory } from '../../scripts/psychology-peer-production.js';
import { createDeepSeekClient, DEEPSEEK_PHOTO_MODEL } from './deepseek.js';
import { createKieClient } from './kie.js';
import { searchStockPhotos } from './photo-publishing.js';
import { preparePeerPhotosForKie, deletePeerPhotoSources, loadPeerPhotoChatImages } from './peer-photo-convert.js';
import { resolveTikTokPhotoSource } from './tikhub-photo-source.js';
import { withProductionPatch, compactProduction } from '../../scripts/production-timeline.js';

// Paid submissions are never blindly retried after an ambiguous provider error.
const SUBMIT = { retries: { limit: 0, delay: '1 second' }, timeout: '2 minutes' };
const READ = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' };
const CONVERT = { retries: { limit: 1, delay: '3 seconds' }, timeout: '3 minutes' };
const PHOTO_STORY_MODEL = DEEPSEEK_PHOTO_MODEL;
const PHOTO_STORY_FALLBACK_MODEL = 'gemini-3-8-flash';

export async function runPeerPhotoWorkflow(env, event, step) {
  const id = event.payload.jobId;
  const row = await step.do('load-source', READ, () => env.DB.prepare("SELECT * FROM factory_jobs WHERE id = ? AND type = 'psychology-photo-story'").bind(id).first());
  if (!row || ['done', 'failed', 'canceled', 'cancelled'].includes(row.status)) return { skipped: true };
  const payload = JSON.parse(row.payload_json);
  const kie = createKieClient({ apiKey: env.KIE_API_KEY, fetchImpl: env.fetch || fetch });
  const deepseek = String(env.DEEPSEEK_API_KEY || '').trim()
    ? createDeepSeekClient({ apiKey: env.DEEPSEEK_API_KEY, fetchImpl: env.fetch || fetch })
    : null;
  let plan = null;
  const results = [];
  let total = 0;
  let state = {};
  let kiePhotos = { urls: [], keys: [] };
  const chat = { model: deepseek ? PHOTO_STORY_MODEL : PHOTO_STORY_FALLBACK_MODEL, primaryFailed: !deepseek };
  async function save(name, status, percent, message, error = '', patch = {}) {
    const at = await step.do(`${name}-time`, () => Date.now());
    state = withProductionPatch(state, {status,message,...patch}, at);
    await step.do(name, READ, () => env.DB.prepare(`UPDATE factory_jobs SET status=?, percent=?, message=?, result_json=?, error=?, worker_id='cloud-photo', updated_at=?, completed_at=? WHERE id=?`)
      .bind(status, percent, message, JSON.stringify({ plan, results, production:compactProduction(state.production), execution: 'cloud', analysisModel: chat.model, progressCurrent: results.length, progressTotal: total }), error, at, ['done','failed'].includes(status) ? at : 0, id).run());
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
    await save('converting', 'running', 6, `已获取原帖 ${total} 张图片，正在转成模型可识别的 JPEG/PNG/WebP…`, '', {productionStage:'script'});
    kiePhotos = await paidCall(step, 'prepare-kie-images', () => preparePeerPhotosForKie(env, id, source.urls), CONVERT, '原图转码失败。');
    const rewrite = payload.rewriteCopy !== false;
    await save('source-ready', 'running', 8, `原图已转码，${deepseek ? 'DeepSeek V4.1 Flash' : 'Gemini 3.8 Flash'} 正在逐张判断文案卡片或素材底图${rewrite ? '并改写文案' : '并提取原文'}…`, '', {productionStage:'script'});
    let validationError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const prompt = buildPhotoStoryPrompt(payload, { sceneCount: total }) + (validationError ? `\nCorrect this validation error: ${validationError}` : '');
      const text = await photoChat(env, kie, deepseek, step, `story-${attempt}`, prompt, kiePhotos, chat);
      try { plan = parsePhotoStory(text, { sceneCount: total }); break; } catch (error) { validationError = error.message; }
    }
    if (!plan) throw new Error(validationError);
    if (payload.psychologyAutomation?.template === 'photo-text') {
      plan.scenes = plan.scenes.map((scene,index) => ({
        ...scene, template:'text', textKind:index === 0 ? 'cover' : 'content',
        title:index === 0 ? [scene.title,scene.subtitle,scene.body].filter(Boolean).join(' ') : scene.title,
        body:index === 0 ? '' : [scene.subtitle,scene.body].filter(Boolean).join('\n'), subtitle:'', stockQuery:'',
      }));
    }
    await save('story-ready', 'running', 15, `${total} 页已分类，封面和详情底图分开搜索…`, '', {productionStage:'images'});
    const stockPools = { cover: null, content: null };
    for (let index = 0; index < plan.scenes.length; index++) {
      const scene = plan.scenes[index];
      if (scene.template === 'stock') {
        const role = stockRole(scene, index);
        await save(`image-${index}-starting`, 'running', progress(total, results.length), `正在为第 ${index+1}/${total} 页匹配${role === 'cover' ? '封面' : '详情'}底图…`, '', {productionScene:{index,text:scene.text,imagePrompt:scene.stockQuery,imageStatus:'running'}});
        if (!stockPools[role]) stockPools[role] = await loadStockPhotos(env, step, role, plan.scenes);
        const photo = stockPools[role].shift();
        if (!photo) throw new Error(`第 ${index + 1} 页没有可用的${role === 'cover' ? '封面' : '详情'}底图。`);
        results.push(photoPage(scene, index, photo, role));
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

function stockRole(scene, index) {
  return scene.textKind === 'cover' || index === 0 ? 'cover' : 'content';
}

function coverStockQuery(scenes) {
  const scene = scenes.find((item, index) => item.template === 'stock' && stockRole(item, index) === 'cover');
  const analysis = scene?.sourceImageAnalysis || {};
  const text = [scene?.stockQuery, analysis.subject, analysis.background, analysis.composition, analysis.colors]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
  return text || 'couple sunset landscape portrait';
}

// Content pages unify on one style: group each page's background description
// into a scenery bucket, keep the majority bucket, and search once with its
// first description. Minority styles (e.g. 2 starry pages among 3 ocean
// pages) reuse the majority pool instead of pulling in stray results.
const CONTENT_STYLES = [
  /ocean|sea\b|seaside|beach|coast|shore|wave|bay|harbor/i,
  /night|star|starry|moon|milky way|galaxy/i,
  /forest|tree|wood|jungle|misty/i,
  /mountain|hill|cliff|valley|canyon/i,
  /desert|dune|sand\b/i,
  /field|meadow|grass|flower/i,
  /interior|room|hallway|window|indoor|cafe/i,
  /sky|cloud|sunset|sunrise|dawn|dusk|horizon|pastel/i,
];

function contentStyleIndex(query) {
  for (let index = 0; index < CONTENT_STYLES.length; index += 1) {
    if (CONTENT_STYLES[index].test(query)) return index;
  }
  return -1;
}

function contentStockQuery(scenes) {
  const queries = scenes
    .filter((item, index) => item.template === 'stock' && stockRole(item, index) === 'content')
    .map((item) => String(item.stockQuery || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (!queries.length) return 'bright airy daylight sky pastel horizon';
  const buckets = new Map();
  for (const query of queries) {
    const style = contentStyleIndex(query);
    if (!buckets.has(style)) buckets.set(style, []);
    buckets.get(style).push(query);
  }
  let dominant = null;
  for (const list of buckets.values()) {
    if (!dominant || list.length > dominant.length) dominant = list;
  }
  return dominant[0].slice(0, 160);
}

async function loadStockPhotos(env, step, role, scenes) {
  const needed = scenes.filter((scene, index) => scene.template === 'stock' && stockRole(scene, index) === role).length;
  const count = String(Math.max(needed, role === 'cover' ? 4 : 6));
  const query = role === 'cover' ? coverStockQuery(scenes) : contentStockQuery(scenes);
  const params = { q: query, count, role };
  if (role === 'cover') params.allowPeople = '1';
  const found = await step.do(`stock-search-${role}`, READ, () => searchStockPhotos(env, new URLSearchParams(params)));
  if (!found.configured) throw new Error('还没有配置 Pexels，无法为有底图的页面匹配素材。');
  const photos = [...(found.photos || [])];
  if (!photos.length) {
    const fallbackQuery = role === 'cover'
      ? 'couple kissing sunset desert mountains landscape'
      : 'bright airy daylight sky pastel horizon ocean';
    const fallback = await step.do(`stock-search-${role}-fallback`, READ, () => searchStockPhotos(env, new URLSearchParams({
      q: fallbackQuery,
      count,
      role,
      ...(role === 'cover' ? { allowPeople: '1' } : {})
    })));
    photos.push(...(fallback.photos || []));
  }
  if (!photos.length) throw new Error(role === 'cover' ? '没有搜到可用的封面底图。' : '没有搜到可用的详情底图。');
  return photos;
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

function photoPage(scene, index, photo, role = 'content') {
  return {
    sceneIndex: index,
    sourceIndex: scene.sourceIndex,
    template: 'stock',
    textKind: role === 'cover' ? 'cover' : 'content',
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

async function photoChat(env, kie, deepseek, step, name, prompt, kiePhotos, chat) {
  return lookAtImages(kie, deepseek, step, name, prompt, await loadPeerPhotoChatImages(env, kiePhotos), chat);
}

async function lookAtImages(kie, deepseek, step, name, prompt, imageUrls, chat) {
  const attempts = [];
  if (!chat.primaryFailed && deepseek) {
    attempts.push({ model: PHOTO_STORY_MODEL, run: () => deepseek.createChat(prompt, { imageUrls }) });
  }
  attempts.push({
    model: PHOTO_STORY_FALLBACK_MODEL,
    run: () => kie.createChat(prompt, { model: PHOTO_STORY_FALLBACK_MODEL, reasoningEffort: 'low', imageUrls })
  });
  let lastError = '看图分析失败。';
  for (const attempt of attempts) {
    try {
      const text = await paidCall(step, `${name}-${attempt.model}`, attempt.run);
      chat.model = attempt.model;
      if (attempt.model === PHOTO_STORY_FALLBACK_MODEL) chat.primaryFailed = true;
      return text;
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 1000);
      if (attempt.model === PHOTO_STORY_MODEL) chat.primaryFailed = true;
    }
  }
  throw new Error(lastError);
}

async function paidCall(step, name, action, config = SUBMIT, fallback = '看图分析失败。') {
  const outcome = await step.do(name, config, async () => {
    try {
      return { ok: true, value: await action() };
    } catch (error) {
      return { ok: false, error: String(error?.message || error).slice(0, 1000) };
    }
  });
  if (!outcome?.ok) throw new Error(outcome?.error || fallback);
  return outcome.value;
}
