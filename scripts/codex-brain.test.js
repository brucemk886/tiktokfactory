import assert from "node:assert/strict";
import test from "node:test";
import { createCodexBrainService } from "./codex-brain.js";

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
