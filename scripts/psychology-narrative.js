const ALLOWED_LAYOUTS = new Set(["single", "choices-4", "choices-6"]);
const QUIZ_TYPE_CONFIG = Object.freeze({
  "hidden-number": { label: "隐藏数字", layout: "single", choiceCount: 0, aspectRatio: "4:3" },
  "position-choice": { label: "位置选择", layout: "choices-6", choiceCount: 6, aspectRatio: "4:3" },
  "character-choice": { label: "人物选择", layout: "choices-4", choiceCount: 4, aspectRatio: "16:9" },
  "embrace-choice": { label: "拥抱偏好", layout: "choices-4", choiceCount: 4, aspectRatio: "16:9" },
});

export const PSYCHOLOGY_TARGET2_QUIZ_TYPES = Object.freeze(Object.keys(QUIZ_TYPE_CONFIG));

export const NARRATIVE_SCORE_THRESHOLD = 85;
export const DEFAULT_NARRATIVE_LANGUAGE = "en";

export function detectNarrationLanguage(value) {
  return /[\u3400-\u9fff]/u.test(String(value || "")) ? "zh-CN" : "en";
}

export function normalizeNarrativeLanguage(value) {
  return String(value || "").trim().toLowerCase().startsWith("zh") ? "zh-CN" : DEFAULT_NARRATIVE_LANGUAGE;
}

export function narrativeTtsProviderForText(value) {
  return detectNarrationLanguage(value) === "zh-CN" ? "elevenlabs" : "kokoro";
}

export function parseNarrativePlan(value, options = {}) {
  const source = typeof value === "string" ? parseJsonText(value) : value;
  if (!source || typeof source !== "object") throw new Error("AI 没有返回有效的心理学测试 JSON。");

  const topic = clean(options.topic || source.title || "心理学测试");
  const forcedLayout = ALLOWED_LAYOUTS.has(options.layout) ? options.layout : "";
  const narration = clean(source.narration || source.zh || source.voiceover || "");
  const language = detectNarrationLanguage(narration);
  const captions = normalizeCaptions(source, narration, language);
  const visualPrompt = clean(source.visualPrompt || source.imagePrompt || source.visual || "");
  const requestedQuizType = normalizeQuizType(options.quizType);
  const sourceQuizType = normalizeQuizType(source.quizType);
  const quizType = requestedQuizType !== "auto"
    ? requestedQuizType
    : sourceQuizType !== "auto"
      ? sourceQuizType
      : inferQuizType(topic, visualPrompt, narration);
  const layout = forcedLayout || (ALLOWED_LAYOUTS.has(source.layout) ? source.layout : quizTypeConfig(quizType).layout);
  const choiceLabels = normalizeChoiceLabels(source.choiceLabels, quizTypeConfig(quizType).choiceCount);

  const hooks = Array.from(new Set(
    (Array.isArray(source.hooks) ? source.hooks : [source.selectedHook || source.hook || source.title])
      .map(clean)
      .filter(Boolean)
  )).slice(0, 3);

  if (language === "zh-CN" && chineseLength(narration) < 28) throw new Error("心理学中文解说太短，至少需要 28 个汉字。");
  if (language === "en" && wordCount(narration) < 20) throw new Error("心理学英文解说太短，至少需要 20 个英文单词。");
  if (!visualPrompt) throw new Error("心理学测试缺少生图描述。");
  if (captions.length < 2) throw new Error("心理学测试至少需要 2 条逐句字幕。");

  return {
    language,
    title: clean(source.title || topic).slice(0, language === "zh-CN" ? 36 : 90) || topic.slice(0, 90),
    englishTitle: clean(source.englishTitle || source.titleEn || "").slice(0, 90),
    credit: clean(options.credit || source.credit || "一知心理课 一场心灵旅").slice(0, 24) || "一知心理课 一场心灵旅",
    thesis: clean(source.thesis || source.coreIdea || "").slice(0, 180),
    hooks,
    selectedHook: clean(source.selectedHook || hooks[0] || topic),
    narration,
    captions,
    visualPrompt,
    quizType,
    layout,
    choiceLabels,
    closingQuestion: clean(source.closingQuestion || source.question || captions.at(-1)?.zh || ""),
    responseAction: clean(source.responseAction || source.cta || (language === "zh-CN" ? "把你的选择扣在评论区" : "Comment your choice below")),
  };
}

export function buildNarrationSegments(plan = {}) {
  const narration = clean(plan?.narration || "");
  const language = detectNarrationLanguage(narration);
  const sourceCaptions = Array.isArray(plan?.captions) ? plan.captions : [];
  const sentenceParts = mergeShortNarrationSentences(
    narration.split(/(?<=[。！？.!?])/u).map(clean).filter(Boolean),
    language
  );
  const fallbackParts = sourceCaptions.map((item) => clean(item?.zh || "")).filter(Boolean);
  const parts = (sentenceParts.length ? sentenceParts : fallbackParts).slice(0, 8);
  return parts.map((primary, index) => ({
    zh: primary,
    en: language === "zh-CN"
      ? clean(sourceCaptions[index]?.en || fallbackEnglish(primary, index))
      : "",
  }));
}

export function scoreNarrativePlan(plan, { targetDuration = 16 } = {}) {
  const dimensions = {};
  const language = detectNarrationLanguage(plan?.narration || "");
  const captions = Array.isArray(plan?.captions) ? plan.captions : [];
  const completeCaptions = captions.filter((item) => item.zh && (language === "en" || item.en));
  dimensions.structure = (plan?.title && plan?.narration && plan?.visualPrompt ? 10 : 0)
    + (completeCaptions.length >= 2 && completeCaptions.length <= 4 ? 10 : Math.min(8, completeCaptions.length * 3));

  const uniqueHooks = new Set((plan?.hooks || []).map(normalizedKey)).size;
  const hookLength = language === "zh-CN"
    ? chineseLength(plan?.selectedHook || plan?.title || "")
    : wordCount(plan?.selectedHook || plan?.title || "");
  dimensions.opening = (uniqueHooks >= 3 ? 8 : uniqueHooks * 2)
    + (language === "zh-CN"
      ? (hookLength >= 10 && hookLength <= 28 ? 12 : hookLength >= 8 && hookLength <= 36 ? 7 : 0)
      : (hookLength >= 5 && hookLength <= 14 ? 12 : hookLength >= 3 && hookLength <= 18 ? 7 : 0));

  const narrationLen = language === "zh-CN" ? chineseLength(plan?.narration || "") : wordCount(plan?.narration || "");
  const expectedMin = language === "zh-CN" ? Math.max(36, Number(targetDuration) * 2.4) : Math.max(20, Number(targetDuration) * 1.8);
  const expectedMax = language === "zh-CN" ? Math.max(expectedMin + 20, Number(targetDuration) * 5.2) : Math.max(expectedMin + 12, Number(targetDuration) * 3.2);
  dimensions.pacing = (narrationLen >= expectedMin && narrationLen <= expectedMax ? 12 : narrationLen >= expectedMin * 0.72 && narrationLen <= expectedMax * 1.25 ? 7 : 2)
    + (captions.length >= 2 && captions.length <= 4 ? 8 : 3);

  const readablePrimary = captions.filter((item) => language === "zh-CN" ? chineseLength(item.zh) <= 22 : wordCount(item.zh) <= 16).length;
  const readableSecondary = captions.filter((item) => language === "en" ? !item.en || wordCount(item.en) <= 12 : wordCount(item.en) <= 12).length;
  dimensions.scanability = Math.round((readablePrimary / Math.max(1, captions.length)) * 8)
    + Math.round((readableSecondary / Math.max(1, captions.length)) * 7);

  const diagnosticRisk = hasDiagnosticClaim(plan);
  dimensions.retention = diagnosticRisk
    ? 0
    : (PSYCHOLOGY_TARGET2_QUIZ_TYPES.includes(plan?.quizType) ? 8 : 0)
      + (chineseLength(plan?.visualPrompt) >= 40 ? 7 : chineseLength(plan?.visualPrompt) >= 18 ? 4 : 0);
  dimensions.cta = (/[？?]/.test(plan?.closingQuestion || "") ? 5 : 0)
    + (/(评论|选择|扣|comment|choose|choice|reply)/i.test(plan?.responseAction || plan?.narration || "") ? 5 : 0);

  const score = Object.values(dimensions).reduce((sum, value) => sum + value, 0);
  const maximums = { structure: 20, opening: 20, pacing: 20, scanability: 15, retention: 15, cta: 10 };
  const failedDimensions = Object.entries(dimensions)
    .filter(([name, value]) => value < maximums[name] * 0.75)
    .map(([name]) => name);
  if (diagnosticRisk) failedDimensions.push("safety");
  return {
    score,
    dimensions,
    failedDimensions: Array.from(new Set(failedDimensions)),
    language,
    narrationCharacters: narrationLen,
    diagnosticRisk,
    passed: score >= NARRATIVE_SCORE_THRESHOLD && !diagnosticRisk,
  };
}

export function buildNarrativePlanPrompt({ topic, angle = "", script = "", targetDuration = 16, credit = "PSYCHOLOGY LAB", layout = "auto", quizType = "auto", language = DEFAULT_NARRATIVE_LANGUAGE } = {}) {
  const duration = clamp(Math.round(Number(targetDuration) || 16), 12, 20);
  const normalizedQuizType = normalizeQuizType(quizType);
  const typeHint = quizTypePrompt(normalizedQuizType, layout);
  const contentLanguage = clean(script) && detectNarrationLanguage(script) === "zh-CN"
    ? "zh-CN"
    : normalizeNarrativeLanguage(language);
  if (contentLanguage === "en") {
    return [
      "You are an English-language psychology short-video writer. Create one 12-20 second Psychology Target 2 interactive self-observation quiz. Use one persistent test image, a question at the top, English narration, sentence-matched English captions, and a final comment CTA.",
      `Topic or source idea: ${clean(topic)}`,
      angle ? `Result guidance or core idea (translate it into natural English if needed): ${clean(angle)}` : "Core idea: connect an everyday choice or first impression to a relatable emotional habit without pretending it is a clinical diagnosis.",
      script ? `User-provided source copy. Preserve its idea and write the final narration in English:\n${clean(script)}` : "No complete script was supplied. Write an original English script.",
      `Output target: a 16:9 light information board lasting about ${duration} seconds, with exactly one test image and one English narration track. A stick-figure companion is added later, so do not describe it in visualPrompt.`,
      `The top-right credit is added later as "${clean(credit || "PSYCHOLOGY LAB")}". Do not place the credit, title, or captions inside the generated image.`,
      "Write 3 clearly different English hook titles and select the strongest one as title. Keep the selected title between 5 and 14 words.",
      "narration must contain 32-50 English words in 3-4 complete sentences. Ask the test question, give a viewing or choice instruction, offer one non-diagnostic psychological interpretation, and end by asking the viewer to comment what they chose or noticed.",
      "Safety: this is entertainment and self-observation, not diagnosis. Never claim an image can measure depression, anxiety, a personality disorder, or disease severity. Rewrite those ideas as emotional fatigue, stress, guardedness, relationship preferences, or another non-clinical tendency. Do not cite unnamed research as proof.",
      "captions must match narration sentence by sentence in exactly the same order. Store the exact spoken English sentence in captions[i].zh (legacy primary-caption field) and set captions[i].en to an empty string. Do not summarize or rewrite it. Each caption should stay under 16 words. Audio timing and SVG changes will follow the measured duration of each sentence.",
      typeHint,
      "visualPrompt must be written in English and describe only the test asset: a clear subject, flat composition, and generous negative space for a white information board. Do not generate a video title, explanatory text, captions, logo, watermark, play button, or UI frame. Only hidden-number and position-choice quizzes may contain test-required digits or A-F markers.",
      "quizType must be hidden-number, position-choice, character-choice, or embrace-choice. layout must match the quiz type: single, choices-6, or choices-4.",
      "choiceLabels: use an empty array for hidden-number, A-F for position-choice, and A-D for character-choice or embrace-choice.",
      "Return exactly one JSON object and no Markdown. Use exactly these fields:",
      '{"language":"en","title":"English hook title","englishTitle":"same English title","thesis":"core idea","hooks":["hook 1","hook 2","hook 3"],"selectedHook":"selected hook","narration":"complete English narration","captions":[{"zh":"Exact spoken English sentence.","en":""}],"visualPrompt":"English visual prompt","quizType":"position-choice","layout":"choices-6","choiceLabels":["A","B","C","D","E","F"],"closingQuestion":"One question?","responseAction":"Comment your choice below"}'
    ].join("\n");
  }
  return [
    "你是中文心理学短视频编剧。请写一条 12-20 秒的『心理学·目标2』互动小测试：同一张测试图贯穿、顶部问题、中文口播、底部双语字幕、结尾引导评论。",
    `选题：${clean(topic)}`,
    angle ? `核心观点或结果提示：${clean(angle)}` : "核心观点：用日常选择或第一眼看到的东西，映射一种可共鸣的心理状态。不要伪装成临床诊断。",
    script ? `用户提供的素材文案（保留观点，改写成短解说）：\n${clean(script)}` : "用户未提供完整文案，请原创。",
    `成片目标：16:9 横版浅色信息板，约 ${duration} 秒，只有 1 张测试图和 1 段中文口播；右侧简笔人物由后期生成，visualPrompt 不要描述简笔人物。`,
    `右上角署名后期添加为「${clean(credit || "一知心理课 一场心灵旅")}」，生图里不要出现这个署名、标题或字幕。`,
    "先写 3 个明显不同的中文钩子标题，选择其中最强的一个作为 title。title 要像「你下意识选择的位置，藏着你的防备心有多强」，10-28 个汉字。",
    "narration 是完整中文口播，42-80 个汉字，三到四句，每句尽量 8-20 个汉字：先抛出测试问题，再给观看或选择指令，用一句非诊断性的心理解释保持悬念，最后明确让观众评论选项或看到的内容。",
    "安全规则：这是娱乐和自我观察内容。不要声称一张图能测出抑郁、焦虑、人格障碍或疾病程度；若选题含这类说法，改写为情绪疲惫、压力状态、防备方式或关系偏好。不要使用『心理研究已经证明』等无来源权威话术。",
    "captions 必须和 narration 逐句一一对应，数量完全相同；captions[i].zh 必须原样等于 narration 的第 i 句，不允许摘要或改写。英文每条不超过 12 个单词。后期会按每句真实配音时长同步字幕和 SVG。",
    typeHint,
    "visualPrompt 只用英文描述测试素材本身：主体清楚、构图平直、四周留白，适合嵌入白色信息板。不要生成视频标题、解释字幕、logo、水印、播放按钮或 UI 边框。只有隐藏数字和位置选择题允许出现测试必需的数字或 A-F 标记。",
    "quizType 只能是 hidden-number、position-choice、character-choice、embrace-choice；layout 必须与题型对应：single、choices-6 或 choices-4。",
    "choiceLabels：隐藏数字题返回空数组；位置题返回 A-F；人物或拥抱题返回 A-D。",
    "只返回一个 JSON 对象，不要 Markdown。字段必须严格为：",
    '{"language":"zh-CN","title":"中文钩子标题","englishTitle":"English title","thesis":"核心观点","hooks":["钩子1","钩子2","钩子3"],"selectedHook":"选中的钩子","narration":"完整中文口播","captions":[{"zh":"中文字幕","en":"English caption"}],"visualPrompt":"English visual prompt","quizType":"position-choice","layout":"choices-6","choiceLabels":["A","B","C","D","E","F"],"closingQuestion":"一个问题？","responseAction":"把你的选择扣在评论区"}'
  ].join("\n");
}

export function buildNarrativeRevisionPrompt({ plan, score, targetDuration = 16 } = {}) {
  const language = detectNarrationLanguage(plan?.narration || "");
  if (language === "en") {
    return [
      "Fix only the failed scoring dimensions in this English psychology image-and-narration quiz. Keep the topic unchanged.",
      `Target duration: ${clamp(Math.round(Number(targetDuration) || 16), 12, 20)} seconds.`,
      `Current score: ${Number(score?.score) || 0}/100.`,
      `Failed dimensions: ${(score?.failedDimensions || []).join(", ") || "overall pacing"}.`,
      `Dimension scores: ${JSON.stringify(score?.dimensions || {})}`,
      "Keep the original quiz type, 3 hooks, one 32-50 word English narration in 3-4 sentences, exact sentence-matched primary captions in captions[i].zh with captions[i].en empty, one clean test image prompt, a closing question, and a comment action.",
      "If safety failed, remove clinical diagnosis, disease-severity claims, and unsupported research claims. Reframe them as entertainment and non-clinical self-observation.",
      "Return the complete revised JSON object only, without Markdown.",
      JSON.stringify(plan)
    ].join("\n");
  }
  return [
    "请只修复下面心理学图片+解说测试评分未达标的维度，不要改变选题。",
    `目标时长：${clamp(Math.round(Number(targetDuration) || 16), 12, 20)} 秒。`,
    `当前得分：${Number(score?.score) || 0}/100。`,
    `未达标维度：${(score?.failedDimensions || []).join(", ") || "整体节奏"}。`,
    `各维度：${JSON.stringify(score?.dimensions || {})}`,
    "保持原题型、3 个钩子、1 段完整中文口播、3-4 条逐句一一对应的双语字幕、一张无片头文字的测试图、结尾问题和评论动作。captions[i].zh 必须原样等于 narration 第 i 句。",
    "若未达标维度含 safety，必须删除临床诊断、疾病程度和无来源的『研究证明』断言，改成娱乐性自我观察表达。",
    "只返回修订后的完整 JSON 对象，不要 Markdown。",
    JSON.stringify(plan)
  ].join("\n");
}

export function narrativeStylePrompt(plan, { variant = 1 } = {}) {
  const quizType = PSYCHOLOGY_TARGET2_QUIZ_TYPES.includes(plan?.quizType) ? plan.quizType : inferQuizType(plan?.title, plan?.visualPrompt, plan?.narration);
  return [
    `Premium standalone test asset for an ${detectNarrationLanguage(plan?.narration || "") === "en" ? "English-language" : "Chinese-language"} psychology quiz video, clean commercial illustration, high-contrast focal subject, flat front-facing composition, social-media ready.`,
    quizTypeImagePrompt(quizType),
    `Visual metaphor: ${clean(plan?.visualPrompt)}`,
    `Creative render variant ${Math.max(1, Number(variant) || 1)}: change art direction, lighting, palette, and character or object design while keeping the same test meaning.`,
    "The asset will be placed inside a warm-white information board with a separately animated stick-figure companion. Do not render that companion.",
    "Do not render video titles, explanations, captions, logos, watermarks, frames, play buttons, or UI. Test-relevant hidden digits or A-F position markers are allowed only when required by the selected quiz type."
  ].join("\n");
}

export function normalizeQuizType(value) {
  const normalized = clean(value).toLowerCase();
  return PSYCHOLOGY_TARGET2_QUIZ_TYPES.includes(normalized) ? normalized : "auto";
}

export function quizTypeLabel(value) {
  const normalized = normalizeQuizType(value);
  return normalized === "auto" ? "自动识别" : QUIZ_TYPE_CONFIG[normalized].label;
}

export function imageAspectRatioForQuizType(value) {
  const normalized = normalizeQuizType(value);
  return normalized === "auto" ? "16:9" : QUIZ_TYPE_CONFIG[normalized].aspectRatio;
}

export function quizTypeAllowsGeneratedMarks(value) {
  return ["hidden-number", "position-choice"].includes(normalizeQuizType(value));
}

function normalizeCaptions(source, narration, language) {
  const raw = Array.isArray(source.captions) ? source.captions : [];
  const captions = raw.slice(0, 4).map((item) => ({
    zh: clean(item?.zh || item?.text || item?.caption || (language === "en" ? item?.en : "") || ""),
    en: language === "en" ? "" : clean(item?.en || item?.translation || item?.english || ""),
  })).filter((item) => item.zh);
  if (captions.length >= 2) {
    return captions.map((item, index) => ({
      zh: item.zh.slice(0, language === "zh-CN" ? 22 : 120),
      en: language === "zh-CN" ? (item.en || fallbackEnglish(item.zh, index)).slice(0, 80) : "",
    }));
  }
  const parts = splitNarration(narration, language).slice(0, 4);
  if (parts.length < 2 && narration) {
    const words = language === "en" ? narration.split(/\s+/).filter(Boolean) : [];
    if (language === "en" && words.length >= 2) {
      const midpoint = Math.ceil(words.length / 2);
      parts.splice(0, parts.length, words.slice(0, midpoint).join(" "), words.slice(midpoint).join(" "));
    } else {
      const midpoint = Math.max(8, Math.floor(narration.length / 2));
      parts.splice(0, parts.length, narration.slice(0, midpoint).trim(), narration.slice(midpoint).trim());
    }
  }
  return parts.filter(Boolean).map((primary, index) => ({
    zh: primary.slice(0, language === "zh-CN" ? 22 : 120),
    en: language === "zh-CN" ? fallbackEnglish(primary, index) : "",
  }));
}

function inferQuizType(topic, visualPrompt, narration) {
  const haystack = `${topic} ${visualPrompt} ${narration}`.toLowerCase();
  if (/(拥抱|hug|embrace)/i.test(haystack)) return "embrace-choice";
  if (/(位置|站位|座位|电梯|房间|position|elevator|seat)/i.test(haystack)) return "position-choice";
  if (/(背影|女生|人物|女孩|哪个人|character|woman|girl|silhouette)/i.test(haystack)) return "character-choice";
  if (/(数字|看见|隐藏|错觉|视力|number|digit|illusion|optical)/i.test(haystack)) return "hidden-number";
  return "character-choice";
}

function quizTypeConfig(value) {
  return QUIZ_TYPE_CONFIG[PSYCHOLOGY_TARGET2_QUIZ_TYPES.includes(value) ? value : "character-choice"];
}

function normalizeChoiceLabels(value, count) {
  if (!count) return [];
  const supplied = Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, count) : [];
  return Array.from({ length: count }, (_, index) => supplied[index] || String.fromCharCode(65 + index));
}

function quizTypePrompt(value, legacyLayout) {
  const type = value === "auto"
    ? legacyLayout === "single" ? "hidden-number" : legacyLayout === "choices-4" ? "character-choice" : "auto"
    : value;
  if (type === "hidden-number") return "题型固定为 hidden-number：一张方形或 4:3 的纹理错觉图，藏入 2-4 位可辨认数字；layout 用 single，choiceLabels 为空。";
  if (type === "position-choice") return "题型固定为 position-choice：一个电梯、房间或日常空间的正面场景，明确标出 A-F 六个可选位置；layout 用 choices-6。";
  if (type === "character-choice") return "题型固定为 character-choice：四个差异明显的人物或背影从左到右并排，不在图内写标签，后期会叠加 A-D；layout 用 choices-4。";
  if (type === "embrace-choice") return "题型固定为 embrace-choice：四组差异明显的拥抱姿势从左到右并排，不在图内写标签，后期会叠加 A-D；layout 用 choices-4。";
  return "根据选题只选择一种题型：看数字/错觉用 hidden-number；选位置用 position-choice；选人物或背影用 character-choice；拥抱偏好用 embrace-choice。";
}

function quizTypeImagePrompt(value) {
  if (value === "hidden-number") return "Format: a single square or 4:3 optical texture with one intentionally embedded 2-4 digit numeral. The hidden digits are required test content; no other text.";
  if (value === "position-choice") return "Format: one simple front-facing elevator, room, or spatial scene with exactly six clearly separated empty positions. Small A-F position markers are required test content; no other text.";
  if (value === "embrace-choice") return "Format: exactly four distinct pairs demonstrating four different hugging poses in one straight horizontal row, fully visible bodies, even spacing, no letters or text.";
  return "Format: exactly four distinct people or back-view characters in one straight horizontal row, fully visible bodies, even spacing, no letters or text.";
}

function hasDiagnosticClaim(plan) {
  const text = clean([
    plan?.title,
    plan?.selectedHook,
    plan?.thesis,
    plan?.narration,
    plan?.closingQuestion,
    plan?.responseAction,
  ].join(" "));
  const clinicalTerm = /(抑郁症?|焦虑症?|双相|躁郁|人格障碍|精神疾病|心理疾病)/;
  const diagnosticAssertion = /(程度|等级|轻度|中度|重度|患有|诊断|测出|证明|说明你有|暴露出)/;
  const englishClinicalTerm = /\b(depression|anxiety|bipolar|personality disorder|mental illness)\b/i;
  const englishDiagnosticAssertion = /\b(diagnos(?:e|es|ed|is)|severity|mild|moderate|severe|proves?|reveals? you have|measures?)\b/i;
  return (clinicalTerm.test(text) && diagnosticAssertion.test(text))
    || (englishClinicalTerm.test(text) && englishDiagnosticAssertion.test(text));
}

function splitNarration(value, language) {
  return clean(value)
    .split(language === "zh-CN" ? /(?<=[，。！？,.!?])/ : /(?<=[.!?])/)
    .map(clean)
    .filter((item) => language === "zh-CN" ? chineseLength(item) >= 4 : wordCount(item) >= 3);
}

function mergeShortNarrationSentences(parts, language = "zh-CN") {
  const lengthOf = language === "zh-CN" ? chineseLength : wordCount;
  const minimum = language === "zh-CN" ? 4 : 3;
  const merged = [];
  for (const part of parts) {
    if (lengthOf(part) < minimum && merged.length) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}${language === "zh-CN" ? "" : " "}${part}`;
    } else {
      merged.push(part);
    }
  }
  if (merged.length > 1 && lengthOf(merged[0]) < minimum) {
    merged[1] = `${merged[0]}${language === "zh-CN" ? "" : " "}${merged[1]}`;
    merged.shift();
  }
  return merged.filter((item) => lengthOf(item) >= 2);
}

function fallbackEnglish(zh, index) {
  if (/评论|选择|扣/.test(zh)) return "Comment your choice below.";
  if (index === 0) return "Look closely and trust your first instinct.";
  return "What you notice first says something about you.";
}

function parseJsonText(value) {
  const text = String(value || "").trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回内容中没有 JSON 对象。");
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch (error) {
    throw new Error(`心理学测试 JSON 解析失败：${error.message}`);
  }
}

function chineseLength(value) {
  return clean(value).replace(/[\s，。！？、；：,.!?;:'"“”‘’()（）—-]/g, "").length;
}

function wordCount(value) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function normalizedKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, " ").trim();
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}
