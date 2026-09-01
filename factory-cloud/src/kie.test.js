import assert from "node:assert/strict";
import test from "node:test";
import { createKieClient } from "./kie.js";

test("creates a nano-banana image task with the no-text rule", async () => {
  const calls = [];
  const kie = createKieClient({
    apiKey: "test-key",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
      return json({ code: 200, data: { taskId: "task-1" } });
    }
  });
  const created = await kie.createKieMediaTask("image", "A quiet lake", {
    imageModel: "nano-banana",
    aspectRatio: "9:16",
    noImageText: true
  });
  assert.equal(created.taskId, "task-1");
  assert.equal(created.model, "google/nano-banana");
  assert.equal(calls[0].body.model, "google/nano-banana");
  assert.equal(calls[0].body.input.output_format, "png");
  assert.match(calls[0].body.input.prompt, /Do not render any visible text/);
});

test("creates a grok video task without rewriting the prompt", async () => {
  const calls = [];
  const kie = createKieClient({
    apiKey: "test-key",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
      return json({ code: 200, data: { taskId: "video-1" } });
    }
  });
  const created = await kie.createKieMediaTask("video", "Rain on neon streets", {
    aspectRatio: "9:16",
    duration: "10",
    resolution: "720p"
  });
  assert.equal(created.model, "grok-imagine/text-to-video");
  assert.deepEqual(calls[0].body.input, {
    prompt: "Rain on neon streets",
    aspect_ratio: "9:16",
    mode: "normal",
    duration: "10",
    resolution: "720p"
  });
});

test("reads a finished Kie task", async () => {
  const kie = createKieClient({
    apiKey: "test-key",
    fetchImpl: async () => json({
      code: 200,
      data: {
        state: "success",
        progress: 100,
        resultJson: JSON.stringify({ resultUrls: ["https://cdn.example/image.png"] }),
        creditsConsumed: 3,
        completeTime: 2000
      }
    })
  });
  const remote = await kie.getKieTask("task-1");
  assert.equal(remote.state, "success");
  assert.deepEqual(remote.resultUrls, ["https://cdn.example/image.png"]);
  assert.equal(remote.creditsConsumed, 3000);
});

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
