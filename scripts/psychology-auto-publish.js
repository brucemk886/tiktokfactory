export const AUTO_TEMPLATES = Object.freeze({
  video: [
    { id: 'psychology', label: '四图测试' },
    { id: 'psychology-collage', label: '纸张拼贴' },
    { id: 'psychology-target-2', label: '单图互动测试' },
  ],
  photo: [
    { id: 'photo-original', label: '跟随原帖 · 文案卡片 / 素材底图' },
    { id: 'photo-text', label: '文案卡片 · 深色封面 + 浅色内容' },
  ],
});
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };

export function normalizeAutoPublish(input, now = Date.now(), { validateSchedule = true } = {}) {
  const mediaType = String(input.mediaType || 'video');
  if (!Object.hasOwn(AUTO_TEMPLATES, mediaType)) fail('请选择图文或视频。');
  const template = String(input.template || '');
  if (!AUTO_TEMPLATES[mediaType].some(item => item.id === template)) fail('模板与内容类型不匹配。');
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
  if (!['peer','topic-bank'].includes(sourceType) || (sourceType === 'topic-bank' && mediaType !== 'video')) fail('题库仅支持 1、2、3 号视频模板。');
  const onlyUnused = sourceType === 'topic-bank' && input.onlyUnused !== false;
  const selection = input.selection || 'random';
  if (!(sourceType === 'topic-bank' ? ['random','priority','recent','least-used'] : ['random','popular','recent']).includes(selection)) fail('选题抽取方式无效。');
  const musicIds = mediaType === 'photo'
    ? [...new Set((Array.isArray(input.musicIds) ? input.musicIds : []).map(id => String(id).trim()).filter(Boolean))]
    : [];
  if (musicIds.length > 100 || musicIds.some(id => !/^\d{1,30}$/.test(id))) fail('配乐池最多 100 个纯数字音乐 ID。');
  return { requestId: input.requestId, name: String(input.name || '心理学自动发布').trim().slice(0, 100), mediaType, template, sourceType, onlyUnused, count, connectionIds, scheduleAt, intervalMinutes, selection, query: String(input.query || '').trim().slice(0, 100), rewriteCopy: input.rewriteCopy === true, musicIds };
}

export function assignments(config, sources) {
  if (sources.length < config.count) fail(`符合条件的选题只有 ${sources.length} 条，请减少生成条数或调整筛选。`);
  return sources.slice(0, config.count).map((source, index) => ({
    source,
    connectionId: config.connectionIds[index % config.connectionIds.length],
    scheduleAt: config.scheduleAt + Math.floor(index / config.connectionIds.length) * config.intervalMinutes * 60,
  }));
}
