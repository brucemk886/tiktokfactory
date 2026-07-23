import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createKieAiService } from "./kie-ai.js";

test("creates and refreshes a Kie image task", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "kie-ai-"));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (String(url).includes("createTask")) return json({ code: 200, data: { taskId: "task-1" } });
    if (String(url).includes("recordInfo")) return json({ code: 200, data: { state: "success", progress: 100, resultJson: JSON.stringify({ resultUrls: ["https://cdn.example/image.png"] }), creditsConsumed: 3 } });
    if (String(url).includes("chat/credit")) return json({ code: 200, data: 100 });
    throw new Error(`Unexpected URL ${url}`);
  };
  const service = createKieAiService({ workDir, readApiKey: () => "test-key", fetchImpl, now: () => 1000 });
  const created = await service.createTask({ kind: "image", prompt: "A quiet lake", imageModel: "nano-banana", aspectRatio: "9:16", noImageText: true });
  assert.equal(created.status, "waiting");
  assert.equal(calls[0].body.model, "google/nano-banana");
  assert.match(calls[0].body.input.prompt, /Do not render any visible text/);
  const refreshed = await service.refreshTask(created.id);
  assert.equal(refreshed.status, "success");
  assert.deepEqual(refreshed.resultUrls, ["https://cdn.example/image.png"]);
  assert.equal((await service.getOverview()).tasks.length, 1);
});

test("stores a synchronous Kie chat response", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "kie-chat-"));
  const fetchImpl = async (url) => {
    if (String(url).includes("chat/completions")) return json({ choices: [{ message: { content: "A useful answer" } }], credits_consumed: 0.2 });
    if (String(url).includes("chat/credit")) return json({ code: 200, data: 99.8 });
    throw new Error(`Unexpected URL ${url}`);
  };
  const service = createKieAiService({ workDir, readApiKey: () => "test-key", fetchImpl, now: () => 2000 });
  const task = await service.createTask({ kind: "chat", prompt: "Improve this hook" });
  assert.equal(task.status, "success");
  assert.equal(task.resultText, "A useful answer");
  assert.equal(task.model, "gemini-3.5-flash");
});

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
