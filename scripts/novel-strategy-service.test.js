import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNovelStrategyService } from "./novel-strategy-service.js";

test("novel strategy draft, activation and rollback are versioned", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-strategy-"));
  const service = createNovelStrategyService({ statePath: path.join(dir, "state.json") });
  assert.equal(service.getActivePolicy().diagnosis.sampleMinViews, 0);
  service.updateDraft({ diagnosis: { earlyDropPoints: 25 }, rewrite: { maxVariants: 3 } });
  const first = service.activate({ label: "第一版" });
  assert.equal(service.getActivePolicy().diagnosis.earlyDropPoints, 25);
  service.updateDraft({ diagnosis: { earlyDropPoints: 18 } });
  const second = service.activate({ label: "第二版" });
  assert.notEqual(first.activeVersionId, second.activeVersionId);
  service.rollback(first.activeVersionId);
  assert.equal(service.getActivePolicy().diagnosis.earlyDropPoints, 25);
  assert.equal(service.getState().draft.rewrite.maxVariants, 3);
});
