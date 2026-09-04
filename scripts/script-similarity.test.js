import assert from "node:assert/strict";
import test from "node:test";
import { findNearDuplicateScript, promotionCtaMismatch, scriptSimilarity } from "./script-similarity.js";

const original = "My sister stole my wedding date and my parents took her side. I found out from a group chat, not from her. Nobody in my family understood why I was upset. So I made a decision that changed everything.";

test("near-identical rewrites are caught, real rewrites pass", () => {
  const tweaked = original.replace("group chat", "family group chat").replace("upset", "hurt");
  assert.ok(scriptSimilarity(original, tweaked) >= 0.9, String(scriptSimilarity(original, tweaked)));
  const rewritten = "The moment I saw the wedding invitation in our family chat, I knew my sister had taken my date on purpose. My parents said I was overreacting. I decided to stop being the reasonable one.";
  assert.ok(scriptSimilarity(original, rewritten) < 0.3);
  // Case and punctuation do not count as differences.
  assert.equal(scriptSimilarity(original, original.toUpperCase().replace(/\./g, "!")), 1);
});

test("findNearDuplicateScript returns the closest existing version above the threshold", () => {
  const scripts = [
    { id: "s1", title: "v1", text: original },
    { id: "s2", title: "v2", text: "Completely different story about a lighthouse keeper and a storm that never ended." }
  ];
  const exact = findNearDuplicateScript(`${original} `, scripts);
  assert.equal(exact.script.id, "s1");
  assert.equal(exact.similarity, 1);
  assert.equal(findNearDuplicateScript("A brand new opening nobody has written before, about a stolen inheritance.", scripts), null);
  assert.equal(findNearDuplicateScript("", scripts), null);
  const loose = findNearDuplicateScript(original.replace("group chat", "family group chat"), scripts, { threshold: 0.7 });
  assert.equal(loose?.script.id, "s1");
});

test("spoken CTA must point at the novel's own code and app", () => {
  const novel = { promotionCode: "479093", platform: "NovelMaster" };
  assert.equal(promotionCtaMismatch("... Search 479093 on the Novel Master app to read the full story.", novel), "");
  assert.equal(promotionCtaMismatch("no call to action here", novel), "");
  assert.match(promotionCtaMismatch("Search 123456 on the Novel Master app to read the full story.", novel), /123456/);
  assert.match(promotionCtaMismatch("Search 479093 on the GoodNovel app to read the full story.", novel), /GoodNovel/);
  // Without a code on the novel only the platform is checked.
  assert.equal(promotionCtaMismatch("Search 999 on the GoodNovel app.", { platform: "GoodNovel" }), "");
});
