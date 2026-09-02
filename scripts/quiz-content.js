export const QUIZ_ILLUSTRATIONS = Object.freeze([
  "mountain",
  "ocean",
  "desert",
  "landmark",
  "river",
  "globe",
  "boot",
  "planet",
  "leaf"
]);

export const DEFAULT_QUIZ_QUESTIONS = Object.freeze({
  en: Object.freeze([
    question("Which mountain is the highest above sea level?", ["K2", "Mount Everest", "Kangchenjunga"], 1, "mountain"),
    question("Which is the largest ocean on Earth?", ["Atlantic Ocean", "Indian Ocean", "Pacific Ocean"], 2, "ocean"),
    question("Which is the largest hot desert?", ["Sahara Desert", "Gobi Desert", "Arabian Desert"], 0, "desert"),
    question("Which is the smallest country by area?", ["Monaco", "Vatican City", "San Marino"], 1, "landmark"),
    question("Which is the longest river in South America?", ["Amazon River", "Paraná River", "Orinoco River"], 0, "river"),
    question("Which is the largest continent by area?", ["Africa", "North America", "Asia"], 2, "globe"),
    question("Which country is famously shaped like a boot?", ["Greece", "Italy", "Portugal"], 1, "boot")
  ]),
  zh: Object.freeze([
    question("世界上海拔最高的山峰是哪一座？", ["乔戈里峰", "珠穆朗玛峰", "干城章嘉峰"], 1, "mountain"),
    question("地球上面积最大的海洋是哪一个？", ["大西洋", "印度洋", "太平洋"], 2, "ocean"),
    question("世界上面积最大的热带沙漠是哪一个？", ["撒哈拉沙漠", "戈壁沙漠", "阿拉伯沙漠"], 0, "desert"),
    question("世界上国土面积最小的国家是哪一个？", ["摩纳哥", "梵蒂冈", "圣马力诺"], 1, "landmark"),
    question("南美洲最长的河流是哪一条？", ["亚马孙河", "巴拉那河", "奥里诺科河"], 0, "river"),
    question("世界上面积最大的大洲是哪一个？", ["非洲", "北美洲", "亚洲"], 2, "globe"),
    question("哪个国家的版图常被形容为靴子？", ["希腊", "意大利", "葡萄牙"], 1, "boot")
  ])
});

export function normalizeQuizPayload(payload = {}) {
  const language = payload.language === "zh" ? "zh" : "en";
  const source = Array.isArray(payload.questions) && payload.questions.length
    ? payload.questions
    : DEFAULT_QUIZ_QUESTIONS[language];
  if (source.length < 6 || source.length > 9) {
    throw new Error("测试题需要 6–9 道题。 ");
  }
  const questions = source.map((item, index) => normalizeQuestion(item, index));
  const secondsPerQuestion = clampDecimal(payload.secondsPerQuestion, 6, 12, 8);
  const introSeconds = clampDecimal(payload.introSeconds, 0.5, 2, 0.8);
  const outroSeconds = clampDecimal(payload.outroSeconds, 2, 6, 4.2);
  const defaults = language === "zh"
    ? { title: "地理知识测试", hook: "红笔揭晓答案前，你能答对几道？", cta: "你答对了几道？评论区留下分数" }
    : { title: "Geography Quiz", hook: "Which questions can you solve before the red marker reveals every answer?", cta: "What was your score? Comment below" };
  return {
    language,
    title: cleanText(payload.title, defaults.title, 48),
    hook: cleanText(payload.hook, defaults.hook, 80),
    cta: cleanText(payload.cta, defaults.cta, 80),
    seed: clampInteger(payload.seed, 1, 999999, 2609),
    secondsPerQuestion,
    introSeconds,
    outroSeconds,
    durationSeconds: introSeconds + questions.length * secondsPerQuestion + outroSeconds,
    backgroundMusicEnabled: payload.backgroundMusicEnabled !== false,
    backgroundMusicVolume: clampDecimal(payload.backgroundMusicVolume, 0, 1, 0.18),
    questions
  };
}

function normalizeQuestion(item, index) {
  if (!item || typeof item !== "object") throw new Error(`第 ${index + 1} 题格式不正确。`);
  const prompt = cleanText(item.prompt ?? item.question, "", 120);
  const options = Array.isArray(item.options)
    ? item.options.slice(0, 3).map((value) => cleanText(value, "", 54))
    : [];
  if (!prompt) throw new Error(`第 ${index + 1} 题缺少题目。`);
  if (options.length !== 3 || options.some((value) => !value)) {
    throw new Error(`第 ${index + 1} 题必须填写 3 个选项。`);
  }
  const answer = answerIndex(item.answerIndex ?? item.answer);
  if (answer < 0 || answer > 2) throw new Error(`第 ${index + 1} 题的正确答案必须是 A、B 或 C。`);
  const illustration = QUIZ_ILLUSTRATIONS.includes(item.illustration) ? item.illustration : "globe";
  return { prompt, options, answerIndex: answer, illustration };
}

function answerIndex(value) {
  if (typeof value === "string" && /^[abc]$/i.test(value.trim())) return value.trim().toUpperCase().charCodeAt(0) - 65;
  const number = Number(value);
  return Number.isInteger(number) ? number : -1;
}

function question(prompt, options, answerIndexValue, illustration) {
  return Object.freeze({ prompt, options: Object.freeze(options), answerIndex: answerIndexValue, illustration });
}

function cleanText(value, fallback, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function clampDecimal(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
