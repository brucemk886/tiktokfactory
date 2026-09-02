const LAYOUTS = new Set(["full-bleed", "paper-collage", "split-collage"]);
export const COLLAGE_SCORE_THRESHOLD = 85;

export function parseCollagePlan(value, { topic = "心理学", sceneCount = 10 } = {}) {
  const source = typeof value === "string" ? parseJsonText(value) : value;
  if (!source || typeof source !== "object") throw new Error("AI 没有返回有效的心理学拼贴分镜 JSON。");
  const scenes = (Array.isArray(source.scenes) ? source.scenes : []).slice(0, 12).map((scene, index) => ({
    id: `scene-${String(index + 1).padStart(2, "0")}`,
    zh: clean(scene?.zh || scene?.narrationZh || ""),
    en: clean(scene?.en || scene?.narrationEn || ""),
    visualPrompt: clean(scene?.visualPrompt || scene?.imagePrompt || ""),
    layout: LAYOUTS.has(scene?.layout) ? scene.layout : ["full-bleed", "paper-collage", "split-collage"][index % 3],
  }));
  if (scenes.length < 8) throw new Error(`心理学拼贴叙事至少需要 8 个场景，当前只有 ${scenes.length} 个。`);
  const hooks = Array.from(new Set((Array.isArray(source.hooks) ? source.hooks : [source.selectedHook]).map(clean).filter(Boolean))).slice(0, 3);
  return {
    title: clean(source.title || topic).slice(0, 42) || clean(topic).slice(0, 42),
    englishTitle: clean(source.englishTitle || source.titleEn || "").slice(0, 90),
    thesis: clean(source.thesis || source.coreIdea || "").slice(0, 180),
    hooks,
    selectedHook: clean(source.selectedHook || hooks[0] || scenes[0].zh),
    closingQuestion: clean(source.closingQuestion || ""),
    responseAction: clean(source.responseAction || source.cta || ""),
    requestedScenes: clamp(Math.round(Number(sceneCount) || 10), 8, 12),
    scenes,
  };
}

export function scoreCollagePlan(plan, { targetDuration = 90 } = {}) {
  const scenes = Array.isArray(plan?.scenes) ? plan.scenes : [];
  const complete = scenes.filter((scene) => scene.zh && scene.en && scene.visualPrompt).length;
  const dimensions = {};
  dimensions.structure = (scenes.length >= 8 && scenes.length <= 12 ? 8 : 0) + Math.round((complete / Math.max(1, scenes.length)) * 12);
  const uniqueHooks = new Set((plan?.hooks || []).map(key)).size;
  const hookLength = textLength(plan?.selectedHook);
  dimensions.opening = (uniqueHooks >= 3 ? 8 : uniqueHooks * 2) + (hookLength >= 10 && hookLength <= 36 ? 12 : hookLength >= 7 && hookLength <= 44 ? 7 : 0);
  const totalZh = scenes.reduce((sum, scene) => sum + textLength(scene.zh), 0);
  const expectedMin = Math.max(180, Number(targetDuration) * 3.1);
  const expectedMax = Math.max(expectedMin + 60, Number(targetDuration) * 6.4);
  const paced = scenes.filter((scene) => textLength(scene.zh) >= 18 && textLength(scene.zh) <= 62).length;
  dimensions.pacing = (totalZh >= expectedMin && totalZh <= expectedMax ? 8 : totalZh >= expectedMin * .78 && totalZh <= expectedMax * 1.18 ? 4 : 0) + Math.round((paced / Math.max(1, scenes.length)) * 12);
  dimensions.scanability = Math.round((scenes.filter((scene) => textLength(scene.zh) <= 58).length / Math.max(1, scenes.length)) * 8) + Math.round((scenes.filter((scene) => wordCount(scene.en) <= 24).length / Math.max(1, scenes.length)) * 7);
  dimensions.retention = Math.round((new Set(scenes.map((scene) => key(scene.visualPrompt)).filter(Boolean)).size / Math.max(1, scenes.length)) * 10) + Math.min(5, new Set(scenes.map((scene) => scene.layout)).size * 2);
  dimensions.cta = (/[？?]/.test(plan?.closingQuestion || "") ? 5 : 0) + (textLength(plan?.responseAction) >= 2 ? 5 : 0);
  const score = Object.values(dimensions).reduce((sum, value) => sum + value, 0);
  const maximums = { structure: 20, opening: 20, pacing: 20, scanability: 15, retention: 15, cta: 10 };
  const failedDimensions = Object.entries(dimensions).filter(([name, value]) => value < maximums[name] * .75).map(([name]) => name);
  return { score, dimensions, failedDimensions, totalZhCharacters: totalZh, passed: score >= COLLAGE_SCORE_THRESHOLD };
}

export function buildCollagePrompt({ topic, angle = "", script = "", targetDuration = 90, sceneCount = 10, credit = "@心理学" } = {}) {
  const duration = clamp(Math.round(Number(targetDuration) || 90), 60, 120);
  const count = clamp(Math.round(Number(sceneCount) || 10), 8, 12);
  return [
    "你是中文心理学中视频的总编剧和分镜导演。写一条有哲学感、但不伪装成临床诊断的心理叙事视频。",
    `选题：${clean(topic)}`,
    angle ? `核心观点：${clean(angle)}` : "从日常情绪冲突切入，解释成长中的心理张力。",
    script ? `用户素材：${clean(script).slice(0, 5000)}` : "用户未提供完整文案，请原创。",
    `目标：1440×1080 的 4:3 横版，约 ${duration} 秒，${count} 个场景，总中文解说约 ${Math.round(duration * 3.6)}-${Math.round(duration * 5.2)} 个汉字。`,
    `右上角署名后期添加为 ${clean(credit || "@心理学")}，生图内不要出现文字。`,
    "先写 3 个明显不同的开头钩子并选择最强的一个。第一场解说自然包含钩子。",
    "递进结构：反常识钩子 → 具体处境 → 内在冲突 → 代价 → 重新理解 → 可执行收束。不要堆砌空泛金句。",
    "每场中文解说 18-62 个汉字；英文是自然短译，最多 24 个单词。",
    "每个 visualPrompt 用英文描述不同的超现实纸张拼贴隐喻：米白纤维纸、撕边剪纸、旧照片与绘画混合、留白、低饱和土色加一个强调色。",
    "layout 只能是 full-bleed、paper-collage、split-collage，至少交替使用两种。",
    "避免绝对化、羞辱化、制造焦虑、疾病诊断和未经证实的统计。结尾给问题并要求观众评论经历。",
    "只返回 JSON，不要 Markdown：",
    '{"title":"中文标题","englishTitle":"English title","thesis":"核心观点","hooks":["钩子1","钩子2","钩子3"],"selectedHook":"选中钩子","scenes":[{"zh":"中文解说","en":"English subtitle","visualPrompt":"English visual prompt","layout":"paper-collage"}],"closingQuestion":"一个问题？","responseAction":"明确评论动作"}',
  ].join("\n").slice(0, 7900);
}

export function buildCollageRevisionPrompt({ plan, score, targetDuration = 90 } = {}) {
  return [
    "只修复心理学拼贴分镜未达标的维度，不改变选题和核心观点。",
    `目标 ${clamp(Math.round(Number(targetDuration) || 90), 60, 120)} 秒；当前 ${Number(score?.score) || 0}/100。`,
    `未达标：${(score?.failedDimensions || []).join("、") || "整体节奏"}；各维度：${JSON.stringify(score?.dimensions || {})}`,
    "保持 3 个钩子、8-12 个完整双语场景、独特纸张拼贴视觉、结尾问题与评论动作。只返回完整 JSON。",
    JSON.stringify(plan),
  ].join("\n").slice(0, 7900);
}

export function collageImagePrompt(scene, { variant = 1, sceneNumber = 1 } = {}) {
  return [
    "Editorial surreal cut-paper collage for a thoughtful psychology philosophy video, landscape 4:3 composition.",
    "Warm off-white recycled paper with visible fibers, torn edges, archival photo fragments mixed with painterly landscapes, film grain, tactile shadows, earth tones with one vivid accent color, symbolic focal point and negative space.",
    `Scene ${sceneNumber} visual metaphor: ${clean(scene?.visualPrompt)}`,
    `Layout: ${clean(scene?.layout || "paper-collage")}. Creative render variant ${Math.max(1, Number(variant) || 1)}.`,
    "Imagery only. No words, letters, numbers, captions, labels, logos, watermarks, signs, UI, frames, or typography.",
  ].join("\n");
}

function parseJsonText(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回内容中没有 JSON 对象。");
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch (error) { throw new Error(`心理学拼贴分镜 JSON 解析失败：${error.message}`); }
}
function textLength(value) { return clean(value).replace(/[\s，。！？、；：,.!?;:'"“”‘’()（）—-]/g, "").length; }
function wordCount(value) { return clean(value).split(/\s+/).filter(Boolean).length; }
function key(value) { return clean(value).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, " ").trim(); }
function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || min)); }
