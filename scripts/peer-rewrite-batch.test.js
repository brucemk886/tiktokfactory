import assert from "node:assert/strict";
import test from "node:test";
import {
  PEER_LONGFORM_MAX_REGENERATIONS,
  PEER_LONGFORM_MAX_WORDS,
  PEER_LONGFORM_MIN_WORDS,
  PEER_LONGFORM_MODE,
  auditPeerLongformVariants,
  buildOpeningVariantPrompt,
  countEnglishWords,
  createCodexBrainService,
  normalizeOpeningVariantInput
} from "./codex-brain.js";
import {
  LONGFORM_AUDIO_MAX_REGENERATIONS,
  auditLongformAudioRecord,
  isLongformAudioItem,
  runAudioGenerateJob
} from "./audio-generate-job.js";
import {
  buildNarratorGenderPrompt,
  inferNarratorGenderHeuristic,
  narratorGenderOutputSchema,
  parseNarratorGenderResponse
} from "./narrator-gender.js";
import {
  buildCompletedOpeningSyncSql,
  buildPeerRewritePayload,
  buildQueueSql,
  deterministicOpeningJobId,
  parseBatchArgs
} from "./peer-rewrite-audio-batch.js";

const CTA = "Search 443641 on the Novel Master app to read the full story.";

function longScript(kind) {
  const openings = {
    ledger: [
      "My husband's forged invoice proved he planned to erase me before the directors arrived.",
      "He expected security to escort me out while his niece took my clients.",
      "I smiled because the original contract was already waiting inside the boardroom."
    ],
    wedding: [
      "My sister wore my missing ring while promising my fiancé she had never seen it.",
      "Everyone expected me to ruin the ceremony the moment I recognized the engraving.",
      "Instead, I asked the photographer to display the timestamp hidden in his camera."
    ],
    hospital: [
      "The doctor handed my mother a consent form carrying a signature I never wrote.",
      "She expected me to blame the nurse and leave before visiting hours ended.",
      "I stayed because the security log named the one relative nobody had questioned."
    ]
  };
  const sentenceFactories = {
    ledger: (index) => `Invoice marker ${index} exposed another quiet transfer before Aria confronted the crowded boardroom.`,
    wedding: (index) => `Velvet candle ${index} guided Mara through a separate memory while the ceremony guests watched.`,
    hospital: (index) => `Monitor signal ${index} pushed Elena toward a difficult choice beside the sealed records desk.`
  };
  const sentences = [...openings[kind]];
  let index = 1;
  while (countEnglishWords(`${sentences.join(" ")} ${CTA}`) < 800) {
    sentences.push(sentenceFactories[kind](index));
    index += 1;
  }
  return `${sentences.join(" ")} ${CTA}`;
}

function validVariants() {
  return [
    { style: "evidence-slam", styleLabel: "铁证砸脸", title: "The invoice he forged", openingTitle: "His Invoice Erased My Name", coreFact: "He used a forged invoice against the narrator", script: longScript("ledger") },
    { style: "scene-meltdown", styleLabel: "现场失控", title: "The ring on display", openingTitle: "My Ring Stopped Their Wedding", coreFact: "The sister wore the narrator's missing ring", script: longScript("wedding") },
    { style: "cornered-counterstrike", styleLabel: "绝境反杀", title: "The signature was false", openingTitle: "That Consent Form Was Forged", coreFact: "A consent form carried a forged signature", script: longScript("hospital") }
  ];
}

function longformInput(overrides = {}) {
  return normalizeOpeningVariantInput({
    title: "A Test Novel",
    platform: "NovelMaster",
    promotionCode: "443641",
    sourceKind: "peer-transcript",
    sourceText: "My husband forged a company invoice and tried to remove me before the board meeting. I kept the original contract and waited for the directors to arrive. ".repeat(30),
    styles: ["auto", "auto", "auto"],
    narratorGender: "female",
    productionMode: PEER_LONGFORM_MODE,
    targetWordsMin: PEER_LONGFORM_MIN_WORDS,
    targetWordsMax: PEER_LONGFORM_MAX_WORDS,
    maxRegenerations: PEER_LONGFORM_MAX_REGENERATIONS,
    ...overrides
  });
}

test("peer longform audit enforces TikTok hook, pace, duration words, CTA and distinctness", () => {
  const input = longformInput();
  const audit = auditPeerLongformVariants(validVariants(), input);
  assert.equal(audit.passed, true, audit.issues.join("; "));
  assert.ok(audit.metrics.every((item) => item.words >= PEER_LONGFORM_MIN_WORDS && item.words <= PEER_LONGFORM_MAX_WORDS));
  assert.ok(audit.pairSimilarities.every((item) => item.full < 0.78 && item.opening < 0.7));
  const prompt = buildOpeningVariantPrompt(input);
  assert.match(prompt, /3–5 分钟/);
  assert.match(prompt, /完整改写/);
  assert.match(prompt, /静默自审/);
  assert.doesNotMatch(prompt, /大约 200 到 280/);
});

test("peer longform generation performs no more than two targeted regenerations", async () => {
  let calls = 0;
  const invalid = {
    variants: validVariants().map((item) => ({ ...item, script: `${item.script.split(" ").slice(0, 120).join(" ")} ${CTA}` }))
  };
  const valid = { variants: validVariants() };
  const service = createCodexBrainService({
    root: "C:/test-project",
    modelProvider: {
      id: "test",
      async run() {
        calls += 1;
        return { finalResponse: JSON.stringify(calls < 3 ? invalid : valid), usage: { output_tokens: calls } };
      }
    }
  });
  const result = await service.generateOpeningVariants({
    title: "A Test Novel",
    platform: "NovelMaster",
    promotionCode: "443641",
    sourceKind: "peer-transcript",
    sourceText: "My husband forged a company invoice and tried to remove me before the board meeting. I kept the original contract and waited for the directors to arrive. ".repeat(30),
    styles: ["auto", "auto", "auto"],
    narratorGender: "female",
    productionMode: PEER_LONGFORM_MODE,
    targetWordsMin: PEER_LONGFORM_MIN_WORDS,
    targetWordsMax: PEER_LONGFORM_MAX_WORDS,
    maxRegenerations: 99
  });
  assert.equal(calls, 3);
  assert.equal(result.qualityAudit.regenerationCount, 2);
  assert.equal(result.qualityAudit.maxRegenerations, 2);
  assert.equal(result.qualityAudit.rejectionHistory.length, 2);
  assert.ok(result.variants.every((item) => item.styleLabel.includes("3-5分钟版")));
});

test("narrator gender uses first-person relationship evidence and validates model review", () => {
  assert.equal(inferNarratorGenderHeuristic({ text: "My husband fired me after I told him I was pregnant." }).gender, "female");
  assert.equal(inferNarratorGenderHeuristic({ text: "My wife left our home while I called her lawyer." }).gender, "male");
  const items = [{ id: "a", title: "Story", text: "My wife said I had failed her." }];
  assert.match(buildNarratorGenderPrompt(items), /FIRST-PERSON NARRATOR/);
  assert.equal(narratorGenderOutputSchema(1).properties.items.minItems, 1);
  assert.deepEqual(parseNarratorGenderResponse({ items: [{ id: "a", gender: "male", confidence: 0.92, evidence: "The narrator says my wife." }] }, items)[0].gender, "male");
});

test("batch payload selects the gender default voice and creates idempotent queue SQL", () => {
  const row = {
    source_script_id: "peer-1",
    novel_id: "novel-1",
    novel_title: "A Test Novel",
    platform: "NovelMaster",
    promotion_code: "443641",
    category: "revenge",
    selling_point: "betrayal",
    source_text: "My husband forged the contract. ".repeat(200),
    source_label: "Peer hit"
  };
  const payload = buildPeerRewritePayload(row, { gender: "female", confidence: 0.9, evidence: "my husband" }, { batchId: "batch-1", batchIndex: 1, batchTotal: 85 });
  assert.equal(payload.voiceId, "af_jessica");
  assert.equal(payload.maxRegenerations, 2);
  assert.equal(payload.styles.length, 3);
  assert.equal(payload.autoKeep, true);
  assert.equal(payload.autoVoice, true);
  const sql = buildQueueSql([{ payload }], { batchId: "batch-1", createdAt: 100 });
  assert.match(sql, /INSERT OR IGNORE/);
  assert.match(sql, /opening-variants/);
  assert.match(sql, /peer-longform-batch-v1/);
  assert.equal(deterministicOpeningJobId("batch-1", "peer-1"), deterministicOpeningJobId("batch-1", "peer-1"));
  assert.deepEqual(parseBatchArgs(["--enqueue", "--batch-id", "batch-1"]), { enqueue: true, sync: false, status: false, batchId: "batch-1", skipModelGender: false });
});

test("completed opening sync writes three deterministic scripts before one audio job", () => {
  const payload = {
    batchId: "batch-1",
    productionMode: PEER_LONGFORM_MODE,
    targetWordsMin: PEER_LONGFORM_MIN_WORDS,
    targetWordsMax: PEER_LONGFORM_MAX_WORDS,
    maxRegenerations: 2,
    novelId: "novel-1",
    title: "A Test Novel",
    platform: "NovelMaster",
    promotionCode: "443641",
    sourceKind: "peer-transcript",
    sourceText: "My husband forged a company invoice and tried to remove me before the board meeting. I kept the original contract and waited for the directors to arrive. ".repeat(30),
    sourceScriptId: "peer-1",
    parentScriptId: "peer-1",
    styles: ["auto", "auto", "auto"],
    narratorGender: "female",
    voiceId: "af_jessica",
    speechSpeed: 1.1,
    ttsProvider: "kokoro"
  };
  const row = {
    id: "opening-1",
    payload_json: JSON.stringify(payload),
    result_json: JSON.stringify({ variants: validVariants().map((item) => ({ ...item, styleLabel: `${item.styleLabel} · 3-5分钟版` })) })
  };
  const plan = buildCompletedOpeningSyncSql(row, { createdAt: 1000 });
  assert.equal(plan.scriptIds.length, 3);
  assert.equal(plan.audit.passed, true);
  assert.equal((plan.sql.match(/INSERT OR IGNORE INTO factory_novel_scripts/g) || []).length, 3);
  assert.equal((plan.sql.match(/'audio-generate'/g) || []).length, 1);
  assert.match(plan.sql, /directSyncedDone/);
  assert.match(plan.sql, /af_jessica/);
  assert.equal(plan.audioJobId, buildCompletedOpeningSyncSql(row, { createdAt: 2000 }).audioJobId);
});
test("longform audio audit enforces actual 3-5 minute result and max two regenerations", () => {
  assert.equal(isLongformAudioItem({ title: "A Test Novel · 3-5分钟版" }), true);
  assert.equal(auditLongformAudioRecord({ duration: 179, size: 100_000 }).passed, false);
  assert.equal(auditLongformAudioRecord({ duration: 240, size: 100_000 }).passed, true);
  assert.equal(auditLongformAudioRecord({ duration: 301, size: 100_000 }).passed, false);
  assert.equal(LONGFORM_AUDIO_MAX_REGENERATIONS, 2);
});
test("longform audio generation retunes once and never exceeds two regenerations", async (context) => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "longform-audio-retry-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const speeds = [];
  const result = await runAudioGenerateJob({
    root,
    workDir: path.join(root, "work"),
    config: { audioLibraryRoot: root },
    payload: {
      targetAudioDir: "__novel__",
      voiceId: "af_jessica",
      speechSpeed: 1.1,
      items: [{
        scriptId: "script-longform",
        novelId: "novel-longform",
        novelTitle: "A Test Novel",
        platform: "NovelMaster",
        title: "A Test Novel · 3-5分钟版",
        script: longScript("ledger")
      }]
    },
    audioLibrary: {
      async generateFromScript(input) {
        calls += 1;
        speeds.push(input.speechSpeed);
        const source = path.join(root, `generated-${calls}.mp3`);
        fs.writeFileSync(source, Buffer.alloc(100_000, calls));
        return {
          id: `audio-longform-${calls}`,
          title: input.title,
          fileName: path.basename(source),
          targetAudioPath: source,
          duration: calls === 1 ? 160 : 220,
          size: 100_000
        };
      },
      resolveAudioPath() { return ""; }
    },
    novelContentLibrary: { attachScriptAudio() { return {}; } }
  });
  assert.equal(calls, 2);
  assert.deepEqual(speeds, [1.1, 0.8]);
  assert.equal(result.items[0].qualityAudit.regenerationCount, 1);
  assert.equal(result.items[0].qualityAudit.maxRegenerations, 2);
  assert.equal(result.items[0].duration, 220);
});