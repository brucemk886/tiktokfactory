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

test("creates a z-image task with the short no-text rule", async () => {
  const calls = [];
  const kie = createKieClient({
    apiKey: "test-key",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
      return json({ code: 200, data: { taskId: "z-1" } });
    }
  });
  const created = await kie.createKieMediaTask("image", "A quiet lake", {
    imageModel: "z-image",
    aspectRatio: "9:16",
    noImageText: true
  });
  assert.equal(created.model, "z-image");
  assert.equal(calls[0].body.model, "z-image");
  assert.equal(calls[0].body.input.aspect_ratio, "9:16");
  assert.equal(calls[0].body.input.output_format, undefined);
  assert.match(calls[0].body.input.prompt, /Visuals only/);
  assert.match(calls[0].body.input.prompt, /A quiet lake/);
  assert.doesNotMatch(calls[0].body.input.prompt, /Marais|official Z-Image/);
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

test("Gemini 3.8 Flash is the default chat model and receives ordered reference images", async () => {
  const calls = [];
  const kie = createKieClient({ apiKey: "test-key", fetchImpl: async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return json({ data: { choices: [{ message: { content: "rewritten" } }], credits_consumed:0.4 } });
  } });
  const images = ["https://p16.tiktokcdn-us.com/1.webp", "https://p16.tiktokcdn-us.com/2.webp"];
  const result = await kie.createChatCompletion("Analyze in order", { imageUrls: images });
  assert.deepEqual(result, { text:"rewritten", model:"gemini-3-8-flash", creditsConsumed:0.4 });
  assert.match(calls[0].url, /gemini-3-8-flash-openai/);
  assert.equal(calls[0].body.reasoning_effort, "medium");
  assert.deepEqual(calls[0].body.messages[0].content.slice(1).map(part => part.image_url.url), images);
});

test("photo classification can request Gemini 3.5 Flash with low reasoning", async () => {
  const calls = [];
  const kie = createKieClient({ apiKey: "test-key", fetchImpl: async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return json({ choices: [{ message: { content: "ok" } }] });
  } });
  await kie.createChat("Classify", { model: "gemini-3-5-flash", reasoningEffort: "low", imageUrls: ["https://p16.tiktokcdn-us.com/1.webp"] });
  assert.match(calls[0].url, /gemini-3-5-flash-openai/);
  assert.equal(calls[0].body.reasoning_effort, "low");
});

test("accepts inline data URLs and surfaces nested Kie error messages", async () => {
  const kie = createKieClient({ apiKey: "test-key", fetchImpl: async () => json({
    code: 422,
    error: { message: "The image url cannot be fetched" }
  }, 422) });
  await assert.rejects(kie.createChat("Look", { imageUrls: ["data:image/jpeg;base64,/9j/4AAQ"] }), /cannot be fetched/);
});

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
