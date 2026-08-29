import assert from "node:assert/strict";
import test from "node:test";
import { attachPublishRiskMarks } from "./publish-risk-marks.js";

test("attaches hub spam_risk marks onto archive account rows", () => {
  const accounts = attachPublishRiskMarks(
    [
      { schema: "tiktok:acc-1", label: "@kathrynkan86" },
      { connectionId: "acc-2", label: "@safe" },
    ],
    [
      { connectionId: "acc-1", publishRisk: { flagged: true, reason: "spam_risk", label: "官方接口风控", count: 2, lastAt: 1 } },
    ],
  );
  assert.equal(accounts[0].publishRisk.reason, "spam_risk");
  assert.equal(accounts[0].publishRisk.count, 2);
  assert.equal(accounts[1].publishRisk, undefined);
});
