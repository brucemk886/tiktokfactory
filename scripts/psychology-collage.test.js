import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  COLLAGE_SCORE_THRESHOLD,
  buildCollagePrompt,
  collageImagePrompt,
  parseCollagePlan,
  scoreCollagePlan,
} from "./psychology-collage-core.js";

const fixture = () => ({
  title: "情绪成长",
  hooks: ["为什么越进步越容易失控？", "真正让你疲惫的也许正是成长", "情绪可能是旧自我退出的声音"],
  selectedHook: "为什么越进步越容易失控？",
  scenes: Array.from({ length: 10 }, (_, index) => ({
    zh: `当你第${index + 1}次抬高标准，过去保护自己的方式开始失效，情绪提醒你重新理解边界和需要。`,
    en: "As standards rise, old defenses fail and emotions ask you to rebuild your boundaries.",
    visualPrompt: `A different symbolic traveler crossing paper mountain ${index + 1} with a unique object and landscape`,
    layout: ["full-bleed", "paper-collage", "split-collage"][index % 3],
  })),
  closingQuestion: "你最近哪一种情绪，正在提醒你重建边界？",
  responseAction: "把你的经历留在评论区。",
});

test("parses 8-12 bilingual 4:3 collage scenes", () => {
  const plan = parseCollagePlan(`\`\`\`json\n${JSON.stringify(fixture())}\n\`\`\``, { sceneCount: 10 });
  assert.equal(plan.scenes.length, 10);
  assert.equal(plan.hooks.length, 3);
  assert.deepEqual(new Set(plan.scenes.map((scene) => scene.layout)), new Set(["full-bleed", "paper-collage", "split-collage"]));
});

test("blocks incomplete plans before paid media generation", () => {
  assert.throws(() => parseCollagePlan({ scenes: Array.from({ length: 7 }, () => ({})) }), /至少需要 8 个场景/);
});

test("scores a complete long-form collage plan above the production gate", () => {
  const score = scoreCollagePlan(parseCollagePlan(fixture()), { targetDuration: 90 });
  assert.ok(score.score >= COLLAGE_SCORE_THRESHOLD, JSON.stringify(score));
  assert.equal(score.dimensions.structure, 20);
  assert.equal(score.dimensions.cta, 10);
});

test("prompts enforce 4:3 paper collage, three hooks, bilingual captions and no image text", () => {
  assert.match(buildCollagePrompt({ topic: "情绪成长", targetDuration: 90, sceneCount: 10 }), /3 个明显不同的开头钩子/);
  assert.match(buildCollagePrompt({ topic: "情绪成长", targetDuration: 90, sceneCount: 10 }), /超现实纸张拼贴/);
  const visual = collageImagePrompt(fixture().scenes[0], { variant: 2, sceneNumber: 1 });
  assert.match(visual, /landscape 4:3/);
  assert.match(visual, /No words/);
  const zImagePlan = buildCollagePrompt({ topic: "情绪成长", targetDuration: 90, sceneCount: 10, imageModel: "z-image" });
  assert.match(zImagePlan, /REFERENCE ONLY/);
  assert.match(zImagePlan, /Marais district of Paris/);
  assert.doesNotMatch(zImagePlan, /超现实纸张拼贴/);
  const zImageVisual = collageImagePrompt(fixture().scenes[0], { variant: 2, sceneNumber: 1, imageModel: "z-image" });
  assert.match(zImageVisual, /Scene 1 visual metaphor/);
  assert.doesNotMatch(zImageVisual, /cut-paper collage/);
  assert.doesNotMatch(zImageVisual, /Marais|balustrade/);
});

test("psychology templates have moved out of the middle-video workbench", () => {
  const html = fs.readFileSync(new URL("../public/mid-video.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /href="\/psychology-collage"/);
  assert.doesNotMatch(html, /href="\/psychology-target-2"/);
});
