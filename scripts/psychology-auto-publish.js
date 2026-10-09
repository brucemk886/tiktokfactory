import { normalizeTimeZone } from './psychology-schedule-time.js';
import { styleById } from '../public/psychology-visual-styles.js';
export const AUTO_TEMPLATES = Object.freeze({
  video: [
    { id: 'psychology', label: '四图测试' },
    { id: 'psychology-collage', label: '纸张拼贴' },
    { id: 'psychology-target-2', label: '单图互动测试' },
  ],
  photo: [
    { id: 'photo-original', label: '跟随原帖 · 文案卡片 / 素材底图' },
    { id: 'photo-text', label: '文案卡片 · 可选20套视觉样式' },
  ],
});
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };

export function normalizeOneProject(input) {
 if(!input||typeof input!=='object'||Array.isArray(input))fail('请选择 TikTok One 品牌账号和项目。');
 const connectionId=String(input.connectionId||'').trim(),accountId=String(input.accountId||'').trim(),campaignId=String(input.campaignId||'').trim();
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(connectionId)||!/^\d{1,30}$/.test(accountId)||!/^\d{1,30}$/.test(campaignId))fail('TikTok One 品牌账号或项目无效，请重新选择。');
 return {connectionId,accountId,campaignId};
}
export function normalizeAutoPublish(input, now = Date.now(), { validateSchedule = true } = {}) {
  const minFollowers=input.minFollowers??0;
  if(![0,1000].includes(minFollowers))fail('粉丝筛选仅支持不限或至少1000粉丝。');
  const mediaType = String(input.mediaType || 'video');
  if (!Object.hasOwn(AUTO_TEMPLATES, mediaType)) fail('请选择图文或视频。');
  const template = String(input.template || '');
  const hitVideos=input.sourceType==='video-hits'&&mediaType==='video'&&template==='selected-video',hitPhotos=input.sourceType==='video-hits'&&mediaType==='photo'&&template==='selected-photo';
  if (!hitVideos&&!hitPhotos&&!AUTO_TEMPLATES[mediaType].some(item => item.id === template)) fail('模板与内容类型不匹配。');
  const count = Number(input.count);
  if (!Number.isInteger(count) || count < 1 || count > 100) fail('每次生成总数应为 1–100 条，每20条合并提交。');
  const connectionIds = [...new Set((Array.isArray(input.connectionIds) ? input.connectionIds : []).map(id => String(id).trim()).filter(Boolean))];
  if (!connectionIds.length || connectionIds.length > 50) fail('请选择 1–50 个账号。');
  if (count < connectionIds.length) fail('生成总数不能少于所选账号数。');
  const scheduleAt = Number(input.scheduleAt);
  const intervalMinutes = Number(input.intervalMinutes);
  if (!Number.isSafeInteger(scheduleAt) || scheduleAt <= 0 || (validateSchedule && scheduleAt < Math.floor(now / 1000) + 300)) fail('首次发布时间至少需要晚于当前时间 5 分钟。');
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) fail('同账号发布间隔应为 1–10080 分钟。');
  const last = scheduleAt + Math.floor((count - 1) / connectionIds.length) * intervalMinutes * 60;
  if (validateSchedule && last * 1000 > now + 14 * 86400000) fail('整批排期需在未来 14 天内。');
  if (!/^[0-9a-f-]{36}$/i.test(String(input.requestId || ''))) fail('提交编号无效，请刷新页面。');
  const sourceType = input.sourceType || 'peer';
  if (!['peer','topic-bank','copy-bank','copy-library','library','video-hits'].includes(sourceType) || (sourceType === 'topic-bank' && mediaType !== 'video')) fail('题库仅支持 1、2、3 号视频模板。');
  if (sourceType === 'library' && mediaType !== 'photo') fail('文案库进化抽取目前只用于图文。');
  if(sourceType==='video-hits'&&((!hitVideos&&!hitPhotos)||typeof input.isAiGenerated!=='boolean'||input.allowPeerReuse===true))fail('二创素材请选择对应的图文或视频直接发布，确认 AI 标识，且不能允许重复使用。');
  let photoVersions;
  if(hitPhotos){if(!Array.isArray(input.photoVersions)||input.photoVersions.length!==count)fail('请勾选与发布条数一致的二创图文。');photoVersions=input.photoVersions.map(r=>{if(!r||!/^vh-[a-f0-9]{32}$/.test(r.sourceId||'')||!Number.isInteger(r.version)||r.version<1||r.version>2147483647||!Number.isSafeInteger(r.revision)||r.revision<1)fail('二创版本标识无效。');return {sourceId:r.sourceId,version:r.version,revision:r.revision};});if(new Set(photoVersions.map(r=>r.sourceId+':'+r.version)).size!==count)fail('同一二创版本不能重复选择。');if(input.rewriteCopy===true)fail('二创图文直接使用已有图片与文案，不支持重新生成。');}
  const onlyUnused = sourceType === 'topic-bank' && input.onlyUnused !== false;
  // The library source has one fixed, data-driven order; nothing to choose.
  const selection = sourceType === 'library' ? 'evolve' : input.selection || 'random';
  if (!(sourceType === 'topic-bank' ? ['random','priority','recent','least-used'] : sourceType==='library' ? ['evolve'] : sourceType==='copy-library' ? ['random','recent'] : ['random','popular','recent']).includes(selection)) fail('选题抽取方式无效。');
  const musicIds = mediaType === 'photo'
    ? [...new Set((Array.isArray(input.musicIds) ? input.musicIds : []).map(id => String(id).trim()).filter(Boolean))]
    : [];
  if (musicIds.length > 100 || musicIds.some(id => !/^\d{1,30}$/.test(id))) fail('配乐池最多 100 个纯数字音乐 ID。');
  const requestedStyleMode=String(input.styleMode||'random');
  // Older open pages may still submit group mode; new tasks now draw per post.
  const styleMode=mediaType==='photo'?(requestedStyleMode==='group'?'random':requestedStyleMode):'legacy',styleId=String(input.styleId||'classic');
  if(!['legacy','fixed','random'].includes(styleMode)||(!styleById(styleId)&&!/^style-[a-f0-9]{32}$/.test(styleId)))fail('图文视觉样式配置无效。');
  if(['copy-bank','copy-library','library'].includes(sourceType)&&input.rewriteCopy===true)fail('文案库内容直接复用，请在改写详情保存新版本后使用。');
  const libraryStrategy=String(input.libraryStrategy||'evolve');
  if(sourceType==='library'&&!['evolve','original','rewrite','pools'].includes(libraryStrategy))fail('文案库抽取策略无效。');
  const libraryTestPolicy=String(input.libraryTestPolicy||'');
  if(libraryTestPolicy && (!['balanced-v1','pools-v1'].includes(libraryTestPolicy)||sourceType!=='library'||input.allowPeerReuse===true))fail('测试策略仅支持文案库且不能重复选题。');
  let poolContext;
  if(sourceType==='library'&&libraryStrategy==='pools'){
    const c=input.poolContext;
    if(libraryTestPolicy!=='pools-v1'||!c||!Number.isSafeInteger(c.cycleStartAt)||c.cycleStartAt<=0||c.cycleStartAt>scheduleAt*1000
      ||!Number.isInteger(c.postsPerDay)||c.postsPerDay<1||c.postsPerDay>10||!Number.isInteger(c.dayIndex)||c.dayIndex<0||c.dayIndex>29
      ||!Number.isInteger(c.round)||c.round<0||c.round>=c.postsPerDay)fail('账号池匹配需要有效的周期、每日配额和轮次。');
    poolContext={cycleStartAt:c.cycleStartAt,postsPerDay:c.postsPerDay,dayIndex:c.dayIndex,round:c.round,...(c.timeZone!==undefined?{timeZone:normalizeTimeZone(c.timeZone)}:{})};
  }else if(libraryTestPolicy==='pools-v1')fail('账号池测试政策只能用于账号池匹配。');
  const pairSeed=sourceType==='library'?String(input.pairSeed||'').slice(0,120):'';
  const staggerSeconds=Number(input.staggerSeconds||0);
  if(!Number.isInteger(staggerSeconds)||staggerSeconds<0||staggerSeconds>600)fail('账号错开秒数应为 0–600。');
  const libraryMediaType=String(input.libraryMediaType||'all');
  if(sourceType==='copy-library'&&!['all','video','photo'].includes(libraryMediaType))fail('请选择有效的原素材类型。');
  const tiktokOne=input.tiktokOne==null?null:normalizeOneProject(input.tiktokOne);
  if(tiktokOne&&mediaType!=='video')fail('TikTok One 挂锚点发布仅支持视频模板。');
  return { ...(hitVideos||hitPhotos?{isAiGenerated:input.isAiGenerated}:{}),...(hitPhotos?{photoVersions}:{}),...(minFollowers?{minFollowers}:{}),...(poolContext?{poolContext}:{}),...(tiktokOne?{tiktokOne}:{}),...(libraryTestPolicy?{libraryTestPolicy}:{}),...(sourceType==='copy-library'?{libraryMediaType}:{}),...(sourceType==='library'&&libraryStrategy!=='evolve'?{libraryStrategy}:{}),...(staggerSeconds?{staggerSeconds}:{}),...(pairSeed?{pairSeed}:{}),styleMode,styleId,allowPeerReuse: input.allowPeerReuse === true, requestId: input.requestId, name: String(input.name || '心理学自动发布').trim().slice(0, 100), mediaType, template, sourceType, onlyUnused, count, connectionIds, scheduleAt, intervalMinutes, selection, query: String(input.query || '').trim().slice(0, 100), rewriteCopy: input.rewriteCopy === true, musicIds };
}

export function assignments(config, sources) {
  if (sources.length < config.count) fail(`符合条件的选题只有 ${sources.length} 条，请减少生成条数或调整筛选。`);
  return sources.slice(0, config.count).map((source, index) => ({
    source,
    connectionId: config.connectionIds[index % config.connectionIds.length],
    scheduleAt: config.scheduleAt + Math.floor(index / config.connectionIds.length) * config.intervalMinutes * 60 + (index % config.connectionIds.length) * (config.staggerSeconds || 0),
  }));
}
