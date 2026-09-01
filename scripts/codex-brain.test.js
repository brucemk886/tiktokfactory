import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildOpeningVariantPrompt, buildOperationPromptV2, clipOpeningSource, createCodexBrainService, normalizeOpeningVariantInput, OPENING_SOURCE_MAX, resolveOpeningModel, resolveOpeningReasoning, spokenAppCta, spokenAppCtaZh, variantsReuseSameOpeningFact } from "./codex-brain.js";

const APP_CTA = " Search 454311 on the Novel Master app to read the full story.";

test("official operation prompt includes mapped novel-effect evidence", () => {
  const prompt = buildOperationPromptV2({
    planDate: "2026-08-13",
    objective: "traffic",
    accountCount: 1,
    stageSummary: [],
    workflowPerformance: [],
    publishTimePerformance: [],
    audioPerformance: [],
    novelContent: {},
    scriptLibrary: [],
    privatePerformance: {},
    contentRuleDiagnostics: {},
    routeContext: {},
    preliminaryStrategy: {},
    deepseekEvidenceReport: {},
    drafts: [],
    novelLearning: {
      promotedPatterns: [{ key: "hook:opening:conflict:first_sentence", status: "promoted", score: 0.2, confidence: 0.8, evaluationCount: 3 }],
      demotedPatterns: [],
      testingPatterns: [],
      activeExperiments: []
    },
    novelEffectAnalysis: {
      summary: { novelCount: 1 },
      novels: [{ id: "novel-1", scripts: [{ id: "script-1", videos: [{ id: "video-1" }] }] }],
      videoMappings: [{ videoId: "video-1", local: { novelId: "novel-1", scriptId: "script-1" } }]
    }
  });

  assert.match(prompt, /Official novel-effect aggregation/);
  assert.match(prompt, /novel-1/);
  assert.match(prompt, /script-1/);
  assert.match(prompt, /joined by TikTok video ID/);
  assert.match(prompt, /Accumulated experiment learning/);
  assert.match(prompt, /hook:opening:conflict:first_sentence/);
});

test("Codex connection test reports a successful local session", async () => {
  const calls = [];
  class FakeCodex {
    constructor(options) {
      calls.push(options || {});
    }

    startThread(options) {
      calls.push(options);
      return {
        run: async () => ({
          finalResponse: "CODEX_CONNECTED",
          usage: { input_tokens: 8, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 }
        })
      };
    }
  }

  const service = createCodexBrainService({ root: "C:/test-project", CodexClass: FakeCodex });
  assert.equal(service.getStatus().connected, false);

  const result = await service.testConnection();
  assert.equal(result.ok, true);
  assert.equal(result.connected, true);
  assert.equal(calls[1].sandboxMode, "read-only");
  assert.equal(calls[1].networkAccessEnabled, false);
  assert.equal(calls[1].approvalPolicy, "never");
});

test("Codex connection test rejects unexpected responses", async () => {
  class FakeCodex {
    startThread() {
      return { run: async () => ({ finalResponse: "unexpected", usage: null }) };
    }
  }

  const service = createCodexBrainService({ root: "C:/test-project", CodexClass: FakeCodex });
  await assert.rejects(service.testConnection(), /不符合预期/);
  assert.equal(service.getStatus().connected, false);
  assert.equal(service.getStatus().lastTest.ok, false);
});

test("novel marketing uses Sol, returns 20 hooks and saves five selected assets", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-marketing-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const calls = [];
  const marketing = makeMarketingFixture();

  class FakeCodex {
    startThread(options) {
      calls.push({ type: "thread", options });
      return {
        run: async (prompt, options) => {
          calls.push({ type: "run", prompt, options });
          return {
            finalResponse: JSON.stringify(marketing),
            usage: { input_tokens: 500, output_tokens: 1200 }
          };
        }
      };
    }
  }

  const sourceText = "A woman discovers that the husband she trusted has maintained a second family for years. She quietly gathers proof, protects her daughter, and prepares to confront him before he can empty their accounts.";
  const service = createCodexBrainService({ root: "C:/test-project", workDir, CodexClass: FakeCodex });
  const result = await service.generateNovelMarketing({ title: "The Second Family", sourceText });

  assert.equal(calls[0].options.model, "gpt-5.6-sol");
  assert.equal(calls[0].options.modelReasoningEffort, "medium");
  assert.equal(calls[0].options.networkAccessEnabled, false);
  assert.equal(calls[0].options.sandboxMode, "read-only");
  assert.equal(calls[1].options.outputSchema.properties.hooks.minItems, 20);
  assert.match(calls[1].prompt, /<story_source>/);
  assert.equal(result.marketing.hooks.length, 20);
  assert.equal(result.marketing.selected.length, 5);
  assert.equal(result.source.sourceChars, sourceText.length);
  assert.equal(typeof result.durationMs, "number");

  const savedPath = path.join(workDir, "novel-marketing", `${result.id}.json`);
  const saved = JSON.parse(fs.readFileSync(savedPath, "utf8"));
  assert.equal(saved.marketing.selected.length, 5);
  assert.equal(saved.source.sourceChars, sourceText.length);
  assert.equal(Object.hasOwn(saved.source, "sourceText"), false);
  assert.equal(fs.readFileSync(savedPath, "utf8").includes(sourceText), false);
});

test("opening variants return three distinct style scripts", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-openings-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const variants = {
    variants: [
      { style: "conflict-first", styleLabel: "冲突先行", title: "She walked in anyway", openingTitle: "She wore my mother's ring", script: `${"The wedding hall went silent when I said his name out loud and asked why the bride was wearing my mother's ring. ".repeat(8)}${APP_CTA}`, titleZh: "她还是走进去了", openingTitleZh: "她戴着我妈的戒指", scriptZh: "婚礼大厅突然安静，我大声喊出他的名字，质问新娘为什么戴着我妈妈的戒指。" },
      { style: "secret-reveal", styleLabel: "秘密揭开", title: "The invitation was a trap", openingTitle: "The invitation was a trap", script: `${"I was never supposed to know about the second ceremony, but the envelope had my old address and a date I could not forget. ".repeat(8)}${APP_CTA}`, titleZh: "请柬是个陷阱", openingTitleZh: "请柬是个陷阱", scriptZh: "我不该知道第二场仪式，可信封上写着我的旧地址和那个忘不掉的日期。" },
      { style: "forbidden-line", styleLabel: "禁忌越界", title: "My hands would not stop shaking", openingTitle: "I am his secret", script: `${"I am pregnant with my uncle's child and the family still wants me to toast his wife. ".repeat(8)}${APP_CTA}`, titleZh: "我是他的秘密", openingTitleZh: "我是他的秘密", scriptZh: "我怀了叔叔的孩子，家里却还要我给新娘敬酒。" }
    ]
  };
  class FakeCodex {
    startThread() {
      return {
        run: async () => ({ finalResponse: JSON.stringify(variants), usage: { input_tokens: 20, output_tokens: 80 } })
      };
    }
  }
  const service = createCodexBrainService({ root: "C:/test-project", workDir, CodexClass: FakeCodex });
  const result = await service.generateOpeningVariants({
    title: "Secret Uncle",
    sourceText: "A woman has secretly loved her uncle for years and is invited to his wedding anniversary, where old promises and a hidden letter finally collide in front of the family.",
    styles: ["evidence-slam", "identity-bomb", "cornered-counterstrike"]
  });
  assert.equal(result.variants.length, 3);
  assert.deepEqual(result.variants.map((item) => item.style), ["evidence-slam", "identity-bomb", "cornered-counterstrike"]);
  assert.deepEqual(result.variants.map((item) => item.styleLabel), ["铁证砸脸", "身份炸弹", "绝境反杀"]);
  assert.deepEqual(result.variants.map((item) => item.openingTitle), [
    "She wore my mother's ring",
    "The invitation was a trap",
    "I am his secret"
  ]);
  assert.ok(result.variants.every((item) => item.script.length >= 80));
  assert.equal(result.variants[0].scriptZh.includes("戒指"), true);
  assert.equal(result.model, "gpt-5.6-sol");
});

test("opening variants can use Terra as the second-tier model", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-opening-terra-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const calls = [];
  const variants = {
    variants: [
      { style: "conflict-first", styleLabel: "冲突先行", title: "She walked in anyway", openingTitle: "She wore my mother's ring", script: `${"The wedding hall went silent when I said his name out loud and asked why the bride was wearing my mother's ring. ".repeat(8)}${APP_CTA}` }
    ]
  };
  class FakeCodex {
    startThread(options) {
      calls.push(options);
      return { run: async () => ({ finalResponse: JSON.stringify(variants), usage: { output_tokens: 40 } }) };
    }
  }
  const service = createCodexBrainService({ root: "C:/test-project", workDir, CodexClass: FakeCodex });
  const result = await service.generateOpeningVariants({
    title: "Secret Uncle",
    sourceText: "A woman has secretly loved her uncle for years and is invited to his wedding anniversary, where old promises and a hidden letter finally collide in front of the family.",
    styles: ["conflict-first"],
    model: "gpt-5.6-terra"
  });
  assert.equal(calls[0].model, "gpt-5.6-terra");
  assert.equal(result.model, "gpt-5.6-terra");
  assert.equal(resolveOpeningModel("unknown"), "gpt-5.6-sol");
});

test("opening variants pass strong and extreme reasoning effort", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-opening-effort-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const calls = [];
  const variants = {
    variants: [
      { style: "conflict-first", styleLabel: "冲突先行", title: "She walked in anyway", openingTitle: "She wore my mother's ring", script: `${"The wedding hall went silent when I said his name out loud and asked why the bride was wearing my mother's ring. ".repeat(8)}${APP_CTA}` }
    ]
  };
  class FakeCodex {
    startThread(options) {
      calls.push(options);
      return { run: async () => ({ finalResponse: JSON.stringify(variants), usage: { output_tokens: 40 } }) };
    }
  }
  const service = createCodexBrainService({ root: "C:/test-project", workDir, CodexClass: FakeCodex });
  const result = await service.generateOpeningVariants({
    title: "Secret Uncle",
    sourceText: "A woman has secretly loved her uncle for years and is invited to his wedding anniversary, where old promises and a hidden letter finally collide in front of the family.",
    styles: ["conflict-first"],
    reasoningEffort: "xhigh"
  });
  assert.equal(calls[0].modelReasoningEffort, "xhigh");
  assert.equal(result.reasoningEffort, "xhigh");
  assert.equal(resolveOpeningReasoning("high"), "high");
  assert.equal(resolveOpeningReasoning("unknown"), "medium");
});

test("opening variants can return a single selected style", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-opening-one-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const variants = {
    variants: [
      { style: "conflict-first", styleLabel: "冲突先行", title: "She walked in anyway", openingTitle: "She wore my mother's ring", script: `${"The wedding hall went silent when I said his name out loud and asked why the bride was wearing my mother's ring. ".repeat(8)}${APP_CTA}` }
    ]
  };
  class FakeCodex {
    startThread() {
      return { run: async () => ({ finalResponse: JSON.stringify(variants), usage: { output_tokens: 40 } }) };
    }
  }
  const service = createCodexBrainService({ root: "C:/test-project", workDir, CodexClass: FakeCodex });
  const result = await service.generateOpeningVariants({
    title: "Secret Uncle",
    sourceText: "A woman has secretly loved her uncle for years and is invited to his wedding anniversary, where old promises and a hidden letter finally collide in front of the family.",
    styles: ["conflict-first"]
  });
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].style, "evidence-slam");
});

test("opening variant prompt forces a stop-scroll first sentence", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-opening-prompt-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const prompts = [];
  const variants = {
    variants: [
      { style: "conflict-first", styleLabel: "冲突先行", title: "She walked in anyway", openingTitle: "She wore my mother's ring", script: `${"Why is the bride wearing my mother's ring in front of two hundred guests? ".repeat(8)}${APP_CTA}` }
    ]
  };
  class FakeCodex {
    startThread() {
      return {
        run: async (prompt) => {
          prompts.push(prompt);
          return { finalResponse: JSON.stringify(variants), usage: { output_tokens: 40 } };
        }
      };
    }
  }
  const service = createCodexBrainService({ root: "C:/test-project", workDir, CodexClass: FakeCodex });
  await service.generateOpeningVariants({
    title: "Secret Uncle",
    sourceText: "A woman has secretly loved her uncle for years and is invited to his wedding anniversary, where old promises and a hidden letter finally collide in front of the family.",
    styles: ["smart-strongest"]
  });
  assert.match(prompts[0], /快速选钩/);
  assert.match(prompts[0], /每条先在心里换 2 个不同前三句/);
  assert.match(prompts[0], /怀孕、死亡、血缘/);
  assert.match(prompts[0], /前三句铁律/);
  assert.match(prompts[0], /第一句做法：/);
  assert.match(prompts[0], /Finally home/);
  assert.match(prompts[0], /I walked into/);
  assert.match(prompts[0], /不要为了凑齐铁证、身份炸弹、婚礼或 mafia/);
  assert.match(prompts[0], /后半段反转也要用/);
  assert.match(prompts[0], /结尾铁律/);
  assert.match(prompts[0], /Search Secret Uncle on the Novel Master app to read the full story/);
  assert.match(prompts[0], /禁止弱收束/);
});

test("spoken app CTA uses the promotion code and platform", () => {
  assert.equal(
    spokenAppCta({ platform: "NovelMaster", promotionCode: "454311" }),
    "Search 454311 on the Novel Master app to read the full story."
  );
  assert.equal(
    spokenAppCtaZh({ platform: "NovelMaster", promotionCode: "454311" }),
    "去 Novel Master APP 搜索 454311，看完整版。"
  );
  assert.match(spokenAppCta({ platform: "GoodNovel", title: "Hidden Heiress" }), /GoodNovel app/);
});

test("opening source keeps a mid-length chapter and windows only longer text", () => {
  const full = `${"A confirmed betrayal sentence that stays in the ledger. ".repeat(180)}`;
  assert.equal(clipOpeningSource(full).length, full.length);
  assert.ok(full.length > 6_000 && full.length < OPENING_SOURCE_MAX);
  const long = `HEAD-START ${"x".repeat(30_000)} TAIL-END-REVEAL`;
  const clipped = clipOpeningSource(long);
  assert.ok(clipped.length <= OPENING_SOURCE_MAX);
  assert.match(clipped, /HEAD-START/);
  assert.match(clipped, /TAIL-END-REVEAL/);
  assert.match(clipped, /middle omitted/);
});

test("opening rewrite prompt keeps mid-script paraphrase and narrator gender", () => {
  const sourceText = "The comments told him to take the other girl, and he did it on live while I stood there holding the ring he promised me last winter. I still have the screenshot and the hotel key he left on the table.";
  const input = normalizeOpeningVariantInput({
    title: "Sold Tonight",
    language: "English",
    sourceKind: "peer-transcript",
    sourceLabel: "同行爆款",
    sourceText,
    styles: ["evidence-slam"],
    narratorGender: "female"
  });
  assert.equal(input.narratorGender, "female");
  const prompt = buildOpeningVariantPrompt(input);
  assert.match(prompt, /只换说法/);
  assert.match(prompt, /成年女性/);
  assert.match(prompt, /中后段是同义改写/);
  assert.equal(prompt.includes("不能写成同义改写"), false);
});

test("two smart openings must use different core facts", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-opening-diverse-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const sameFact = `${"My husband sold me to a mob boss after he drugged my drink at dinner. He thought I would beg. I smiled instead and waited. ".repeat(6)}${APP_CTA}`;
  const service = createCodexBrainService({
    root: "C:/test-project",
    workDir,
    CodexClass: class {
      startThread() {
        return {
          run: async () => ({
            finalResponse: JSON.stringify({
              variants: [
                { style: "smart-strongest", styleLabel: "智能最强钩子", title: "A", openingTitle: "He sold me tonight", script: sameFact, titleZh: "甲", openingTitleZh: "他今晚把我卖了", scriptZh: "同一事实。" },
                { style: "smart-strongest", styleLabel: "智能最强钩子", title: "B", openingTitle: "He sold me tonight", script: sameFact, titleZh: "乙", openingTitleZh: "他今晚把我卖了", scriptZh: "同一事实。" }
              ]
            })
          })
        };
      }
    }
  });
  await assert.rejects(
    service.generateOpeningVariants({
      title: "Secret Uncle",
      sourceText: "A woman has secretly loved her uncle for years and is invited to his wedding anniversary, where old promises and a hidden letter finally collide in front of the family.",
      styles: ["smart-strongest", "smart-strongest"]
    }),
    /同一条核心事实/
  );
  assert.equal(variantsReuseSameOpeningFact([
    { style: "smart-strongest", coreFact: "husband sold her to a mob boss", script: sameFact },
    { style: "smart-strongest", coreFact: "the comments told him to take the other girl", script: `${"The comments told him to take the other girl on live, and he did. ".repeat(8)}${APP_CTA}` }
  ]), false);
});

test("opening variant prompt asks for two different smart-hook facts and keeps category", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-opening-split-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const prompts = [];
  const variants = {
    variants: [
      { style: "smart-strongest", styleLabel: "智能最强钩子", title: "A", openingTitle: "He sold me tonight", script: `${"My husband sold me to a mob boss after he drugged my drink at dinner. ".repeat(8)}${APP_CTA}`, coreFact: "husband sold her to a mob boss", titleZh: "甲", openingTitleZh: "他今晚把我卖了", scriptZh: "丈夫把她卖了。" },
      { style: "smart-strongest", styleLabel: "智能最强钩子", title: "B", openingTitle: "The comments chose her", script: `${"The comments told him to take the other girl on live, and he did it. ".repeat(8)}${APP_CTA}`, coreFact: "live comments told him to take the other girl", titleZh: "乙", openingTitleZh: "评论让他选她", scriptZh: "评论让他选另一个女孩。" }
    ]
  };
  class FakeCodex {
    startThread() {
      return {
        run: async (prompt) => {
          prompts.push(prompt);
          return { finalResponse: JSON.stringify(variants) };
        }
      };
    }
  }
  const service = createCodexBrainService({ root: "C:/test-project", workDir, CodexClass: FakeCodex });
  const result = await service.generateOpeningVariants({
    title: "Secret Uncle",
    category: "女频",
    sellingPoint: "直播评论反转",
    sourceText: "A woman has secretly loved her uncle for years and is invited to his wedding anniversary, where old promises and a hidden letter finally collide in front of the family.",
    styles: ["smart-strongest", "smart-strongest"]
  });
  assert.equal(result.variants.length, 2);
  assert.match(prompts[0], /coreFact 和第一句必须指向不同的原文事件/);
  assert.match(prompts[0], /故事频道：女频/);
  assert.match(prompts[0], /小说卖点：直播评论反转/);
  assert.match(prompts[0], /Search Secret Uncle on the Novel Master app to read the full story/);
});

test("auto styles pick a template from the story instead of locking one recipe", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-opening-auto-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const prompts = [];
  const variants = {
    variants: [
      { style: "scene-meltdown", styleLabel: "现场失控", title: "A", openingTitle: "He chose her on live", script: `${"The comments told him to take the other girl, and he did it on live. ".repeat(8)}${APP_CTA}`, coreFact: "live comments told him to take the other girl", titleZh: "甲", openingTitleZh: "他直播选了她", scriptZh: "评论让他选另一个女孩。" },
      { style: "identity-bomb", styleLabel: "身份炸弹", title: "B", openingTitle: "He was my uncle", script: `${"The man they sold me to was the uncle who raised me after the wedding. ".repeat(8)}${APP_CTA}`, coreFact: "the buyer was her uncle", titleZh: "乙", openingTitleZh: "买我的人是舅舅", scriptZh: "买她的人是养她的舅舅。" }
    ]
  };
  class FakeCodex {
    startThread() {
      return {
        run: async (prompt) => {
          prompts.push(prompt);
          return { finalResponse: JSON.stringify(variants) };
        }
      };
    }
  }
  const service = createCodexBrainService({ root: "C:/test-project", workDir, CodexClass: FakeCodex });
  const result = await service.generateOpeningVariants({
    title: "Secret Uncle",
    sourceText: "A woman has secretly loved her uncle for years and is invited to his wedding anniversary, where old promises and a hidden letter finally collide in front of the family.",
    styles: ["auto", "auto"]
  });
  assert.deepEqual(result.variants.map((item) => item.style), ["scene-meltdown", "identity-bomb"]);
  assert.match(prompts[0], /为这本书单独判断/);
  assert.match(prompts[0], /禁止对所有小说套同一个固定模板/);
  assert.match(prompts[0], /没有铁证不要选铁证砸脸/);
  assert.doesNotMatch(prompts[0], /必须按这个顺序覆盖这 2 种风格/);
});

test("peer transcript rewrite prompt uses the checked口播 instead of free chapters", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-opening-peer-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const prompts = [];
  const variants = {
    variants: [
      { style: "scene-meltdown", styleLabel: "现场失控", title: "A", openingTitle: "He chose her on live", script: `${"The comments told him to take the other girl, and he did it on live. ".repeat(8)}${APP_CTA}`, coreFact: "live comments told him to take the other girl", titleZh: "甲", openingTitleZh: "他直播选了她", scriptZh: "评论让他选另一个女孩。" }
    ]
  };
  class FakeCodex {
    startThread() {
      return {
        run: async (prompt) => {
          prompts.push(prompt);
          return { finalResponse: JSON.stringify(variants) };
        }
      };
    }
  }
  const service = createCodexBrainService({ root: "C:/test-project", workDir, CodexClass: FakeCodex });
  await service.generateOpeningVariants({
    title: "Secret Uncle",
    sourceKind: "peer-transcript",
    sourceLabel: "同行爆款",
    sourceText: "The comments told him to take the other girl, and he did it on live while I stood there holding the ring he promised me last winter.",
    styles: ["auto"]
  });
  assert.match(prompts[0], /先通读勾选的同行爆款口播/);
  assert.match(prompts[0], /禁止回到免费章节另写一条/);
  assert.match(prompts[0], /对照来源：同行爆款口播（同行爆款）/);
  assert.doesNotMatch(prompts[0], /先通读这本书的免费章节/);
});

test("opening titles rewrite only the cover title", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-titles-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const prompts = [];
  class FakeCodex {
    startThread() {
      return {
        run: async (prompt) => {
          prompts.push(prompt);
          return {
            finalResponse: JSON.stringify({
              titles: [{ id: "variant-1", openingTitle: "The Rescue Was Their Trap", openingTitleZh: "这场救援是它们的陷阱" }]
            })
          };
        }
      };
    }
  }
  const service = createCodexBrainService({ root: "C:/test-project", workDir, CodexClass: FakeCodex });
  const result = await service.generateOpeningTitles({
    items: [{
      id: "variant-1",
      openingTitle: "They Staged Their Own Rescue",
      script: "Two tiny snakes I rescued last winter just staged a rescue of their own and now they are hunting me through the house."
    }]
  });
  assert.equal(result.titles.length, 1);
  assert.equal(result.titles[0].openingTitle, "The Rescue Was Their Trap");
  assert.match(prompts[0], /只改视频前 3 秒/);
  assert.match(prompts[0], /They Staged Their Own Rescue/);
});

test("novel marketing rejects source text that is too short", async () => {
  const service = createCodexBrainService({ root: "C:/test-project", CodexClass: class {} });
  await assert.rejects(
    service.generateNovelMarketing({ sourceText: "too short" }),
    (error) => error.statusCode === 400 && /至少输入80个字符/.test(error.message)
  );
});

test("novel marketing turns a disconnected stream into a safe retry error", async () => {
  class FakeCodex {
    startThread() {
      return { run: async () => { throw new Error("stream disconnected before completion"); } };
    }
  }

  const service = createCodexBrainService({ root: "C:/test-project", CodexClass: FakeCodex });
  await assert.rejects(
    service.generateNovelMarketing({ sourceText: "A sufficiently long fictional story source that exceeds eighty characters and can safely exercise the disconnected-stream branch without calling a real model." }),
    (error) => error.statusCode === 503 && /安全重试/.test(error.message)
  );
  assert.equal(service.getStatus().running, false);
  assert.equal(service.getStatus().lastMarketingRun.ok, false);
});

test("AI creation uses medium reasoning and returns directly usable content", async () => {
  const calls = [];
  class FakeCodex {
    startThread(options) {
      calls.push(options);
      return { run: async (prompt) => { calls.push(prompt); return { finalResponse: "A ready-to-use narration.", usage: { output_tokens: 8 } }; } };
    }
  }
  const service = createCodexBrainService({ root: "C:/test-project", CodexClass: FakeCodex });
  const result = await service.generateCreation({ mode: "narration", language: "English", prompt: "Rewrite this psychology test as a voiceover." });
  assert.equal(calls[0].modelReasoningEffort, "medium");
  assert.equal(calls[0].sandboxMode, "read-only");
  assert.match(calls[1], /ElevenLabs/);
  assert.equal(result.content, "A ready-to-use narration.");
});

function makeMarketingFixture() {
  return {
    packageTitle: "The Second Family Launch Pack",
    positioning: "Betrayal story built around a hidden family and financial danger.",
    audience: "Women who enjoy relationship betrayal and revenge stories.",
    coreConflict: "A wife must expose her husband's second life before he steals their savings.",
    hooks: Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      angle: `Angle ${index + 1}`,
      hook: `Hook ${index + 1}: She found proof of the life he hid from her.`,
      emotion: "betrayal",
      curiosityGap: "What she did with the proof"
    })),
    selected: Array.from({ length: 5 }, (_, index) => ({
      rank: index + 1,
      sourceHookId: index + 1,
      angle: `Angle ${index + 1}`,
      title: `The Secret He Thought She Would Never Find ${index + 1}`,
      script: "I found the first receipt in the pocket of the coat he never let me touch. It led me to a storage unit filled with photographs of a family I had never seen, and every envelope carried my husband's handwriting. I copied the documents before he came home and called the woman named on the lease. She did not ask who I was. She only said that my husband had told her I died years ago. Then I checked our savings account and saw a transfer scheduled for Monday morning. By the time he sat down for dinner, I had less than forty-eight hours to decide whether to confront him or let the money move so someone else could trace where it went.",
      hashtags: ["#storytime", "#betrayal", "#redditstories"],
      whyItWins: "It opens with a concrete discovery and promises a consequential reveal."
    }))
  };
}
