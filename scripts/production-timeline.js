// Explicit production events only: UI must not infer completed work from a percent.
export const PRODUCTION_STAGES = ['script', 'audio', 'images', 'render', 'verify', 'done'];
export function withProductionPatch(current = {}, patch = {}, now = Date.now()) {
  const { productionStage, productionScene, productionAudio, productionVideo, ...rest } = patch;
  const previous = current.production || {};
  const production = { ...previous, events: [...(previous.events || [])], scenes: [...(previous.scenes || [])] };
  const stage = patch.status === 'done' ? 'done' : productionStage;
  if (stage && PRODUCTION_STAGES.includes(stage)) {
    if (production.stage !== stage) production.events.push({ stage, at: now, status: 'started', message: String(patch.message || '').slice(0, 300) });
    production.stage = stage;
  }
  if (patch.status === 'failed' && production.events.at(-1)?.status !== 'failed') production.events.push({ stage: production.stage || 'script', at: now, status: 'failed', message: String(patch.message || '执行失败').slice(0, 300) });
  if (productionScene) {
    const index = Number(productionScene.index);
    if (Number.isInteger(index) && index >= 0 && index < 80) {
      const found = production.scenes.findIndex(scene => scene.index === index);
      const scene = { ...(found >= 0 ? production.scenes[found] : {}), ...productionScene, updatedAt: now };
      if (found >= 0) production.scenes[found] = scene; else production.scenes.push(scene);
      production.scenes.sort((a,b) => a.index - b.index);
    }
  }
  if (productionAudio) production.audio = { ...production.audio, ...productionAudio };
  if (productionVideo) production.video = { ...production.video, ...productionVideo };
  if (patch.status === 'failed') {
    production.scenes = production.scenes.map(scene=>({...scene,...(scene.audioStatus==='running'?{audioStatus:'failed'}:{}),...(scene.imageStatus==='running'?{imageStatus:'failed'}:{})}));
    if (production.audio?.status === 'running') production.audio = {...production.audio,status:'failed'};
  }
  production.events = production.events.slice(-160);
  return { ...current, ...rest, production, updatedAt: now };
}

// Keep only reviewable metadata; local paths, tokens and arbitrary worker fields
// cannot be copied into a cloud artboard through this object.
export function compactProduction(value) {
  if (!value || typeof value !== 'object') return null;
  const text = (v, n = 3000) => String(v || '').slice(0,n);
  const number = v => Number.isFinite(Number(v)) ? Math.max(0,Number(v)) : 0;
  const fields = item => ({text:text(item.text),translation:text(item.translation),imagePrompt:text(item.imagePrompt),audioText:text(item.audioText),audioDescription:text(item.audioDescription,500),videoDescription:text(item.videoDescription,500),imageUrl:/^https:\/\//i.test(item.imageUrl || '')?text(item.imageUrl,4000):'',duration:number(item.duration),start:number(item.start),end:number(item.end),audioStatus:text(item.audioStatus,30),imageStatus:text(item.imageStatus,30),index:number(item.index)});
  return {
    stage: PRODUCTION_STAGES.includes(value.stage) ? value.stage : '',
    events:(value.events || []).slice(-160).map(e=>({stage:text(e.stage,30),at:number(e.at),status:text(e.status,30),message:text(e.message,300)})),
    scenes:(value.scenes || []).slice(0,80).map(fields),
    audio: value.audio ? {text:text(value.audio.text,16000),description:text(value.audio.description,500),provider:text(value.audio.provider,60),voice:text(value.audio.voice,100),duration:number(value.audio.duration),status:text(value.audio.status,30)} : null,
    video: value.video ? {description:text(value.video.description,800),aspectRatio:text(value.video.aspectRatio,20),duration:number(value.video.duration)} : null,
  };
}
