import { buildPhotoStoryPrompt } from '../../scripts/psychology-peer-production.js';
import { createDeepSeekClient, DEEPSEEK_PHOTO_MODEL } from './deepseek.js';
import { searchStockPhotos } from './photo-publishing.js';
import { preparePeerPhotosForKie, deletePeerPhotoSources, loadPeerPhotoChatImages } from './peer-photo-convert.js';
import { photoCopyKey, claimPhotoCopy, storePhotoCopy, releasePhotoCopy, photoCopySnapshot, buildCachedCopyRewritePrompt, parseCachedCopyRewrite } from './peer-photo-copy-cache.js';
import { claimAnalysisSlot, releaseAnalysisSlot } from './photo-analysis-gate.js';
import { resolveTikTokPhotoSource } from './tikhub-photo-source.js';
import { withProductionPatch, compactProduction } from '../../scripts/production-timeline.js';

// Paid submissions are never blindly retried after an ambiguous provider error.
// The budget stays above the DeepSeek client timeout so an unanswered request
// reports the abort instead of an opaque step timeout.
const SUBMIT = { retries: { limit: 0, delay: '1 second' }, timeout: '3 minutes' };
const READ = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' };
const CONVERT = { retries: { limit: 1, delay: '3 seconds' }, timeout: '3 minutes' };
const PHOTO_STORY_MODEL = DEEPSEEK_PHOTO_MODEL;

export async function runPeerPhotoWorkflow(env, event, step) {
  const id = event.payload.jobId;
  const row = await step.do('load-source', READ, () => env.DB.prepare("SELECT * FROM factory_jobs WHERE id = ? AND type = 'psychology-photo-story'").bind(id).first());
  if (!row || ['done', 'failed', 'canceled', 'cancelled'].includes(row.status)) return { skipped: true };
  const payload = JSON.parse(row.payload_json);
  const deepseek = String(env.DEEPSEEK_API_KEY || '').trim()
    ? createDeepSeekClient({ apiKey: env.DEEPSEEK_API_KEY, fetchImpl: env.fetch || fetch })
    : null;
  const copyKey = payload.copyVariant?'':photoCopyKey(payload.peerSource?.videoUrl);
  const copyOwner = String(row.created_by || '');
  let copyCache = 'miss';
  let plan = null;
  const results = [];
  let total = 0;
  let state = {};
  let kiePhotos = { urls: [], keys: [] };
  // Queue position follows creation order: batch timestamp first, then the
  // item's own id, which already carries its position inside the batch.
  const chat = { model: PHOTO_STORY_MODEL, holder: id, rank: Number(row.created_at) || 0 };
  async function save(name, status, percent, message, error = '', patch = {}) {
    const at = await step.do(`${name}-time`, () => Date.now());
    state = withProductionPatch(state, {status,message,...patch}, at);
    await step.do(name, READ, () => env.DB.prepare(`UPDATE factory_jobs SET status=?, percent=?, message=?, result_json=?, error=?, worker_id='cloud-photo', updated_at=?, completed_at=? WHERE id=?`)
      .bind(status, percent, message, JSON.stringify({ plan, results, production:compactProduction(state.production), execution: 'cloud', analysisModel: chat.model, sourceCopyCache: copyCache, progressCurrent: results.length, progressTotal: total }), error, at, ['done','failed'].includes(status) ? at : 0, id).run());
  }
  try {
    // No paid stand-in for the primary model: a missing key stops the job here
    // with a message an operator can act on.
    if (!deepseek && !payload.copyVariant) throw new Error('DeepSeek 密钥未配置或已失效，图文分析已停止。');
    await save('starting', 'running', 3, '正在读取原帖逐页文案缓存…', '', {productionStage:'script'});
    let sourceCopy = payload.copyVariant?{pageCount:payload.copyVariant.scenes.length,plan:payload.copyVariant}:null;
    if(sourceCopy)copyCache='imported';
    let acquired = false;
    for (let attempt = 0; !sourceCopy && attempt < 48; attempt++) {
      const cached = await step.do(`copy-cache-claim-${attempt}`, READ, () => claimPhotoCopy(env.DB, copyOwner, copyKey, id));
      if (cached.copy) { sourceCopy = cached.copy; copyCache = 'hit'; break; }
      if (cached.acquired) { acquired = true; break; }
      if (attempt === 0) await save('waiting-copy', 'running', 4, '同一原帖正在提取文案，等待共用结果…', '', {productionStage:'script'});
      await step.sleep(`copy-cache-wait-${attempt}`, '15 seconds');
    }
    if (!sourceCopy && !acquired) throw new Error('原帖文案仍在提取中，请稍后重试此任务。');
    if (!sourceCopy) {
      const source = await step.do('resolve-source-images', READ, () => resolveTikTokPhotoSource(env, {
        url: payload.peerSource?.videoUrl,
        imageUrls: payload.peerSource?.imageUrls
      }));
      total = source.urls.length;
      payload.sceneCount = total;
      if (!payload.script && source.sourceCopy) payload.script = source.sourceCopy.slice(0, 5000);
      await save('converting', 'running', 6, `首次提取原帖 ${total} 张图片，正在准备识别原文…`, '', {productionStage:'script'});
      kiePhotos = await paidCall(step, 'prepare-kie-images', () => preparePeerPhotosForKie(env, id, source.urls), CONVERT, '原图转码失败。');
      await save('source-ready', 'running', 8, '正在按图片编号提取原文和页面类型…', '', {productionStage:'script'});
      let validationError = '';
      // The extraction lease lasts ten minutes but the analysis queue can hold a
      // job for an hour, so the lease is renewed again once the slot is won.
      chat.onSlot = label => step.do(`copy-cache-hold-${label}`, READ, () => claimPhotoCopy(env.DB, copyOwner, copyKey, id));
      for (let attempt = 0; attempt < 3; attempt++) {
        await step.do(`copy-cache-renew-${attempt}`, READ, async () => {
          const lease = await claimPhotoCopy(env.DB, copyOwner, copyKey, id);
          if (!lease.acquired) throw new Error('原帖文案提取锁已变更，请重试任务。');
        });
        const prompt = buildPhotoStoryPrompt({...payload,rewriteCopy:false}, { sceneCount: total }) +
          '\nExtraction only: originalText must contain the COMPLETE verbatim visible text on each page, without shortening or rewriting. sourceIndex must equal its 1-based image position. Preserve original post wording.' +
          (validationError ? `\nCorrect this validation error: ${validationError}` : '');
        const text = await photoChat(env, deepseek, step, `extract-copy-v1-${attempt}`, prompt, kiePhotos, chat);
        try { sourceCopy = photoCopySnapshot(text, payload, total); break; } catch (error) { validationError = error.message; }
      }
      if (!sourceCopy) throw new Error(validationError);
      await step.do('store-source-copy-v1', READ, () => storePhotoCopy(env.DB, copyOwner, copyKey, id, sourceCopy));
      // Source images are temporary inputs only, never part of the shared cache.
      await step.do('delete-extracted-photos', READ, () => deletePeerPhotoSources(env, kiePhotos.keys));
    }
    total = sourceCopy.pageCount;
    plan = structuredClone(sourceCopy.plan);
    if (copyCache === 'hit') chat.model = 'source-copy-cache';
    if (payload.rewriteCopy === true) {
      await save('rewriting-copy', 'running', 10, '已读取原始逐页文案，正在进行纯文字改写…', '', {productionStage:'script'});
      let rewritten = null, validationError = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const prompt = buildCachedCopyRewritePrompt(sourceCopy) + (validationError ? `\nCorrect this validation error: ${validationError}` : '');
        const text = await lookAtImages(env, deepseek, step, `rewrite-copy-v1-${attempt}`, prompt, [], chat);
        try { rewritten = parseCachedCopyRewrite(text, sourceCopy); break; } catch(error) { validationError = error.message; }
      }
      if (!rewritten) throw new Error(validationError);
      plan = rewritten;
    }
    if (payload.psychologyAutomation?.styleId || payload.psychologyAutomation?.template === 'photo-text') {
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
        if (!stockPools[role]) stockPools[role] = await loadStockPhotos(env, step, role, plan.scenes, id);
        const photo = stockPools[role].shift();
        if (!photo) throw new Error(`第 ${index + 1} 页没有可用的${role === 'cover' ? '封面' : '详情'}底图。`);
        results.push(photoPage(scene, index, photo, role));
        await save(`image-${index}-saved`, 'running', progress(total, results.length), `云端已完成 ${results.length}/${total} 页。`, '', {productionScene:{index,imageUrl:photo.fileUrl || photo.imageUrl,imagePrompt:scene.stockQuery,imageStatus:'done'}});
      } else {
        results.push(textPage(scene, index));
        await save(`image-${index}-saved`, 'running', progress(total, results.length), `第 ${index+1}/${total} 页走文案卡片。`, '', {productionScene:{index,text:scene.text,imagePrompt:'',imageStatus:'done'}});
      }
    }
    await save('completed', 'done', 100, `已按原帖顺序完成 ${total} 页（${copyCache === 'hit' ? '复用文案缓存' : '原帖文案已缓存'}）：文案卡片或素材库底图。`);
    return { jobId: id, count: results.length };
  } catch (error) {
    await save('failed', 'failed', progress(total, results.length), '图文复刻失败，已保留完成的页面。', String(error.message || error).slice(0, 1000));
    throw error;
  } finally {
    await step.do('release-copy-cache', READ, () => releasePhotoCopy(env.DB, copyOwner, copyKey, id)).catch(() => {});
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

// Content pads no longer follow the peer post's imagery. They rotate through
// a few fixed bright directions that stay clean behind captions; the job seed
// picks the direction so repeated recreations vary.
export const CONTENT_STOCK_QUERIES = [
  'bright pastel sky over a calm ocean horizon',
  'soft white clouds in a bright blue sky',
  'calm sea at sunrise with a pastel sky',
  'light morning mist over a calm lake',
];

// Pexels ranks results deterministically, so two recreations of the same
// peer hit would keep landing on the same photos. Each job derives a seed
// from its id: the seed picks the Pexels result page and shuffles the pool,
// so repeated runs hand out different backgrounds without extra requests.
export function jobSeed(value) {
  let seed = 5381;
  for (const character of String(value || '')) seed = ((seed * 33) ^ character.charCodeAt(0)) >>> 0;
  return seed;
}

function seededShuffle(list, seed) {
  const items = [...list];
  let state = (seed >>> 0) || 1;
  for (let index = items.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    const pick = state % (index + 1);
    [items[index], items[pick]] = [items[pick], items[index]];
  }
  return items;
}

async function loadStockPhotos(env, step, role, scenes, jobId) {
  const needed = scenes.filter((scene, index) => scene.template === 'stock' && stockRole(scene, index) === role).length;
  // Content over-fetches within the same single request so the shuffle below
  // still leaves one bright photo per page.
  const count = String(role === 'cover' ? Math.max(needed, 4) : Math.min(30, Math.max(needed * 3, 12)));
  const seed = jobSeed(jobId);
  const query = role === 'cover' ? coverStockQuery(scenes) : CONTENT_STOCK_QUERIES[seed % CONTENT_STOCK_QUERIES.length];
  const params = { q: query, count, role };
  if (role === 'cover') params.allowPeople = '1';
  if (role === 'content') params.page = String(1 + ((seed >> 3) % 2));
  const found = await step.do(`stock-search-${role}`, READ, () => searchStockPhotos(env, new URLSearchParams(params)));
  if (!found.configured) throw new Error('还没有配置 Pexels，无法为有底图的页面匹配素材。');
  let photos = [...(found.photos || [])];
  if (!photos.length) {
    const fallbackQuery = role === 'cover'
      ? 'couple kissing sunset desert mountains landscape'
      : 'bright pastel sky over a calm ocean horizon';
    const fallback = await step.do(`stock-search-${role}-fallback`, READ, () => searchStockPhotos(env, new URLSearchParams({
      q: fallbackQuery,
      count,
      role,
      ...(role === 'cover' ? { allowPeople: '1' } : {})
    })));
    photos.push(...(fallback.photos || []));
  }
  if (!photos.length) throw new Error(role === 'cover' ? '没有搜到可用的封面底图。' : '没有搜到可用的详情底图。');
  return role === 'content' ? seededShuffle(photos, seed) : photos;
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

async function photoChat(env, deepseek, step, name, prompt, kiePhotos, chat) {
  return lookAtImages(env, deepseek, step, name, prompt, await loadPeerPhotoChatImages(env, kiePhotos), chat);
}

// A burst of photo jobs can leave DeepSeek queued past the client timeout, and
// those requests answer normally on a later try, so the primary model is only
// abandoned after three consecutive failures.
const PRIMARY_ATTEMPTS = 3;
const PRIMARY_RETRY_DELAYS = ['10 seconds', '30 seconds'];
// Polls stay tight while the queue is short, then slow down: every poll costs
// workflow steps, and an instance only gets so many. 12 × 5s + 177 × 20s is
// roughly an hour of queueing.
const SLOT_WAIT_ATTEMPTS = 189;
const slotWaitDelay = wait => (wait < 12 ? '5 seconds' : '20 seconds');

// The cap is never bypassed. Waiting out a full queue is correct behaviour, and
// letting everyone through on a timer is exactly the stampede it prevents.
async function waitForAnalysisSlot(env, step, name, chat) {
  for (let wait = 0; wait < SLOT_WAIT_ATTEMPTS; wait += 1) {
    if (await step.do(`${name}-${wait}`, READ, () => claimAnalysisSlot(env.DB, chat.holder, chat.rank))) return true;
    await step.sleep(`${name}-wait-${wait}`, slotWaitDelay(wait));
  }
  return false;
}

// There is no second model: three failures stop the job with the upstream's
// own words rather than spending on a stand-in.
async function lookAtImages(env, deepseek, step, name, prompt, imageUrls, chat) {
  let primaryError = '看图分析失败。';
  for (let attempt = 0; attempt < PRIMARY_ATTEMPTS; attempt += 1) {
    // The slot is released between attempts so a backing-off job never holds
    // the queue while it waits.
    if (attempt) await step.sleep(`${name}-${PHOTO_STORY_MODEL}-wait-${attempt}`, PRIMARY_RETRY_DELAYS[attempt - 1]);
    if (!await waitForAnalysisSlot(env, step, `${name}-slot-${attempt}`, chat)) {
      throw new Error('排队等待模型名额超过 60 分钟，已停止等待；请减少同时创建的批次后重试此任务。');
    }
    await chat.onSlot?.(`${name}-${attempt}`);
    try {
      const text = await paidCall(step, `${name}-${PHOTO_STORY_MODEL}${attempt ? `-retry-${attempt}` : ''}`,
        () => deepseek.createChat(prompt, { imageUrls }));
      chat.model = PHOTO_STORY_MODEL;
      return text;
    } catch (error) {
      primaryError = String(error?.message || error).slice(0, 500);
    } finally {
      await step.do(`${name}-slot-release-${attempt}`, READ, () => releaseAnalysisSlot(env.DB, chat.holder));
    }
  }
  throw new Error(`${PHOTO_STORY_MODEL} 连续 ${PRIMARY_ATTEMPTS} 次失败：${primaryError}`);
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
