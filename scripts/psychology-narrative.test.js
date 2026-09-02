import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NARRATIVE_LANGUAGE,
  NARRATIVE_SCORE_THRESHOLD,
  buildNarrationSegments,
  buildNarrativePlanPrompt,
  detectNarrationLanguage,
  imageAspectRatioForQuizType,
  narrativeTtsProviderForText,
  narrativeStylePrompt,
  parseNarrativePlan,
  quizTypeAllowsGeneratedMarks,
  scoreNarrativePlan,
} from "./psychology-narrative.js";

function englishFixturePlan() {
  return {
    language: "en",
    title: "Where You Stand Reveals How Guarded You Feel",
    englishTitle: "Where You Stand Reveals How Guarded You Feel",
    thesis: "An instinctive position can reflect a preferred level of social distance.",
    hooks: [
      "Where You Stand Reveals How Guarded You Feel",
      "Your Elevator Spot Says More Than You Think",
      "Pick One Position Before You Overthink It",
    ],
    selectedHook: "Where You Stand Reveals How Guarded You Feel",
    narration: "Imagine entering an empty elevator. Which position would you choose first? Trust your instinct and pick A through F. Your answer may reflect how much social distance feels comfortable, so comment your choice below.",
    captions: [
      { zh: "Imagine entering an empty elevator.", en: "" },
      { zh: "Which position would you choose first?", en: "" },
      { zh: "Trust your instinct and pick A through F.", en: "" },
      { zh: "Your answer may reflect how much social distance feels comfortable, so comment your choice below.", en: "" },
    ],
    visualPrompt: "A clean front-facing elevator interior with exactly six distinct standing positions, soft neutral lighting, strong negative space, and small A-F floor markers",
    quizType: "position-choice",
    layout: "choices-6",
    choiceLabels: ["A", "B", "C", "D", "E", "F"],
    closingQuestion: "Which position would you choose first?",
    responseAction: "Comment your choice below",
  };
}

function fixturePlan() {
  return {
    title: "你下意识选择的位置，藏着你的防备心有多强",
    englishTitle: "The seat you pick reveals how guarded you are",
    thesis: "第一眼站位会暴露你习惯把安全感放在哪里。",
    hooks: [
      "你下意识选择的位置，藏着你的防备心有多强",
      "电梯里你站哪，其实在暴露安全感",
      "第一眼选的角落，比性格测试更准",
    ],
    selectedHook: "你下意识选择的位置，藏着你的防备心有多强",
    narration: "电梯到了，你会下意识站在哪个位置？仔细看这张图，选一个最舒服的地方，把选项扣在评论区。",
    captions: [
      { zh: "你会下意识站在哪", en: "Where would you stand first?" },
      { zh: "选一个最舒服的位置", en: "Pick the spot that feels safest." },
      { zh: "把选项扣在评论区", en: "Comment your choice below." },
    ],
    visualPrompt: "A warm cinematic elevator interior with six empty standing positions marked only by lighting and floor texture, no UI chrome",
    quizType: "position-choice",
    layout: "choices-6",
    choiceLabels: ["A", "B", "C", "D", "E", "F"],
    closingQuestion: "你第一眼站在了哪个位置？",
    responseAction: "把你的选择扣在评论区",
  };
}

test("parses quiz JSON into a single image-plus-narration plan", () => {
  const plan = parseNarrativePlan(`\`\`\`json\n${JSON.stringify(fixturePlan())}\n\`\`\``, { topic: "防备心", quizType: "position-choice" });
  assert.equal(plan.title, "你下意识选择的位置，藏着你的防备心有多强");
  assert.equal(plan.hooks.length, 3);
  assert.equal(plan.layout, "choices-6");
  assert.equal(plan.quizType, "position-choice");
  assert.deepEqual(plan.choiceLabels, ["A", "B", "C", "D", "E", "F"]);
  assert.equal(plan.captions.length, 3);
  assert.match(plan.narration, /评论区/);
});

test("rejects a quiz plan that has no usable narration", () => {
  assert.throws(
    () => parseNarrativePlan({ title: "太短", visualPrompt: "a test image", captions: [{ zh: "一句", en: "one" }] }),
    /解说太短/
  );
});

test("scores a complete short quiz above the production gate", () => {
  const plan = parseNarrativePlan(fixturePlan(), { topic: "防备心" });
  const score = scoreNarrativePlan(plan, { targetDuration: 16 });
  assert.ok(score.score >= NARRATIVE_SCORE_THRESHOLD, JSON.stringify(score));
  assert.equal(score.passed, true);
  assert.equal(score.dimensions.cta, 10);
});

test("builds one spoken subtitle segment per narration sentence", () => {
  const narration = "假如你走进一个空电梯，你会站在哪里？凭第一直觉做出选择。这个行为暗示了你的安全边界。把选项发在评论区吧。";
  const segments = buildNarrationSegments({
    narration,
    captions: [
      { zh: "走进电梯你站哪里", en: "Where would you stand?" },
      { zh: "凭第一直觉选择", en: "Trust your first instinct." },
      { zh: "它反映安全边界", en: "It reflects your boundaries." },
    ],
  });
  assert.equal(segments.length, 4);
  assert.equal(segments.map((item) => item.zh).join(""), narration);
  assert.equal(segments[0].zh, "假如你走进一个空电梯，你会站在哪里？");
  assert.equal(segments[3].en, "Comment your choice below.");
});

test("defaults to English and routes actual Chinese narration to ElevenLabs", () => {
  assert.equal(DEFAULT_NARRATIVE_LANGUAGE, "en");
  assert.equal(detectNarrationLanguage("Choose the first position that feels safe."), "en");
  assert.equal(narrativeTtsProviderForText("Choose the first position that feels safe."), "kokoro");
  assert.equal(detectNarrationLanguage("凭第一直觉选择一个位置。"), "zh-CN");
  assert.equal(narrativeTtsProviderForText("凭第一直觉选择一个位置。"), "elevenlabs");
});

test("parses and scores an English target-2 plan with sentence-exact primary captions", () => {
  const plan = parseNarrativePlan(englishFixturePlan(), { topic: "guardedness" });
  const score = scoreNarrativePlan(plan, { targetDuration: 16 });
  const segments = buildNarrationSegments(plan);
  assert.equal(plan.language, "en");
  assert.equal(segments.length, 4);
  assert.equal(segments[0].zh, "Imagine entering an empty elevator.");
  assert.equal(segments.every((item) => item.en === ""), true);
  assert.equal(score.passed, true, JSON.stringify(score));
  assert.ok(score.score >= NARRATIVE_SCORE_THRESHOLD, JSON.stringify(score));
});

test("prompts default to English, switch to Chinese for supplied Chinese copy, and keep target-2 constraints", () => {
  const prompt = buildNarrativePlanPrompt({ topic: "拥抱偏好", targetDuration: 16, quizType: "embrace-choice" });
  assert.match(prompt, /English-language psychology short-video writer/);
  assert.match(prompt, /one persistent test image/);
  assert.match(prompt, /embrace-choice/);
  assert.match(prompt, /comment CTA/);
  assert.match(prompt, /match narration sentence by sentence/);
  assert.match(prompt, /"language":"en"/);
  const chinesePrompt = buildNarrativePlanPrompt({ topic: "防备心", script: "你会下意识站在哪里？凭第一直觉选择。把答案发在评论区。", targetDuration: 16 });
  assert.match(chinesePrompt, /中文心理学短视频编剧/);
  assert.match(chinesePrompt, /"language":"zh-CN"/);
  const embrace = { ...fixturePlan(), quizType: "embrace-choice", layout: "choices-4" };
  const visual = narrativeStylePrompt(embrace, { variant: 2 });
  assert.match(visual, /four distinct pairs/);
  assert.match(visual, /variant 2/);
  assert.equal(imageAspectRatioForQuizType("hidden-number"), "4:3");
  assert.equal(imageAspectRatioForQuizType("character-choice"), "16:9");
  assert.equal(quizTypeAllowsGeneratedMarks("hidden-number"), true);
  assert.equal(quizTypeAllowsGeneratedMarks("embrace-choice"), false);
});

test("clinical-looking image tests are blocked until rewritten as non-diagnostic self-observation", () => {
  const risky = parseNarrativePlan({
    ...fixturePlan(),
    title: "你看到的数字藏着你的抑郁程度",
    selectedHook: "你看到的数字藏着你的抑郁程度",
    narration: "仔细看清这张图里藏着的数字，据说它能测出你的抑郁程度。记住第一眼答案，再把数字打在评论区。",
    quizType: "hidden-number",
    layout: "single",
  }, { topic: "隐藏数字", quizType: "hidden-number" });
  const score = scoreNarrativePlan(risky, { targetDuration: 16 });
  assert.equal(score.passed, false);
  assert.equal(score.diagnosticRisk, true);
  assert.ok(score.failedDimensions.includes("safety"));
});

test("middle-video workbench keeps the short psychology quiz separate from long-form collage", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../public/mid-video.html", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../public/psychology-narrative.html", import.meta.url), "utf8");
  const browser = fs.readFileSync(new URL("../public/psychology-narrative.js", import.meta.url), "utf8");
  const server = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("./psychology-narrative-job.js", import.meta.url), "utf8");
  const composition = fs.readFileSync(new URL("../remotion/psychology-landscape.jsx", import.meta.url), "utf8");
  assert.match(html, /href="\/psychology-target-2"[\s\S]*?<strong>心理学 · 目标2<\/strong>/);
  assert.match(html, /href="\/psychology-collage"[\s\S]*?<strong>心理学 · 目标1<\/strong>/);
  assert.match(html, /简笔人动作/);
  assert.match(page, /<h1>心理学 · 目标2<\/h1>/);
  assert.match(page, /data-quiz-type="hidden-number"/);
  assert.match(page, /data-quiz-type="position-choice"/);
  assert.match(page, /data-quiz-type="character-choice"/);
  assert.match(page, /data-quiz-type="embrace-choice"/);
  assert.match(page, /默认英文 · 中文走 ElevenLabs/);
  assert.match(page, /id="elevenLabsApiKey"/);
  assert.match(page, /id="elevenLabsVoiceId"/);
  assert.match(page, /value="am_adam" selected/);
  assert.doesNotMatch(page, /纸张拼贴/);
  assert.match(browser, /\/api\/psychology-narrative\/start/);
  assert.match(browser, /hasChineseText\(script\)/);
  assert.match(browser, /中文 · ElevenLabs/);
  assert.match(server, /"\/psychology-target-2"/);
  assert.match(server, /psychology-narrative-job\.js/);
  assert.match(worker, /PsychologyLandscape/);
  assert.match(worker, /16:9 psychology target 2 persistent-test-image quiz/);
  assert.match(worker, /suppliedPlan/);
  assert.match(worker, /status: "done",\s*error: null/);
  assert.match(worker, /generateKokoroSpeech/);
  assert.match(worker, /synthesizeTimedNarration/);
  assert.match(worker, /caption-timings\.json/);
  assert.match(worker, /text: plan\.narration/);
  assert.match(worker, /captionsFromWordTimings/);
  assert.match(worker, /captionsFromCharacterAlignment/);
  assert.match(worker, /\/with-timestamps\?output_format=/);
  assert.match(worker, /narrativeTtsProviderForText\(plan\.narration\)/);
  assert.doesNotMatch(worker, /speech-segment-/);
  assert.doesNotMatch(worker, /DEFAULT_KOKORO_CHINESE_VOICE/);
  assert.doesNotMatch(composition, /Math\.floor\(frame \/ Math\.max\(1, fps\)\)/);
  assert.match(composition, /const poseIndex = Math\.max\(0, beatIndex\)/);
  assert.match(composition, /STICK_POSE_FILES\.map/);
  assert.match(composition, /beatEndFrame/);
  assert.match(composition, /hasMeasuredTiming/);
  assert.match(composition, /translateX/);
  assert.match(composition, /psychology-poses\/stick-/);
  assert.match(page, /每句话仍按真实时间戳同步字幕和 SVG/);
  for (let index = 1; index <= 8; index += 1) {
    const fileName = `stick-${String(index).padStart(2, "0")}.svg`;
    assert.equal(fs.existsSync(new URL(`../public/psychology-poses/${fileName}`, import.meta.url)), true, fileName);
  }
  assert.doesNotMatch(worker, /舒尔特|tetris/);
  assert.match(worker, /api\.elevenlabs\.io/);
});
