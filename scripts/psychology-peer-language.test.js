import assert from "node:assert/strict";
import test from "node:test";
import { isEnglishPsychologyPeerHit } from "./psychology-peer-language.js";

const hit = (title, extra = {}) => ({ title, videoData: extra });

test("keeps English titles, hashtag-only posts and grokbot Chinese glosses", () => {
  assert.equal(isEnglishPsychologyPeerHit(hit("Cut the cameras")), true);
  assert.equal(isEnglishPsychologyPeerHit(hit("#anxiousattachment #fypシ #avoidantattachment")), true);
  assert.equal(isEnglishPsychologyPeerHit(hit("Avoidant attachment / 回避型依恋")), true);
  assert.equal(isEnglishPsychologyPeerHit(hit("#anxiousattachment | Emotional dependency — mood fused to partner / 情感依赖 — 情绪与伴侣绑定")), true);
  assert.equal(isEnglishPsychologyPeerHit(hit("Why do i always get attached so easy.", { language: "en" })), true);
  assert.equal(isEnglishPsychologyPeerHit(hit("Overthinkers biggest problem: getting too attached / mood depends on partner (anxious attachment)")), true);
  assert.equal(isEnglishPsychologyPeerHit(hit("", { language: "en-US" })), true);
});

test("drops non-English language tags and body copy", () => {
  assert.equal(isEnglishPsychologyPeerHit(hit("Hello", { language: "id" })), false);
  assert.equal(isEnglishPsychologyPeerHit(hit("คนดีๆมีไม่รัก", { language: "th" })), false);
  assert.equal(isEnglishPsychologyPeerHit(hit("kadang kangen dia yang dulu #avoidant")), false);
  assert.equal(isEnglishPsychologyPeerHit(hit("tmn kelas emg kalo ngerjain pr hrs kyk gini ya? serius nanya")), false);
  assert.equal(isEnglishPsychologyPeerHit(hit("dia tu keluar nongkrong dari jam 6 sore smpe subuh ga pulang pdhl posisinya ak lagi kangen")), false);
  assert.equal(isEnglishPsychologyPeerHit(hit("Anxious loves loudly. Avoidant loves quietly. Pareho silang deeply in love pero ibang paraan ng pag-react sa love.")), false);
  assert.equal(isEnglishPsychologyPeerHit(hit("原生家庭如何塑造依恋风格")), false);
});
