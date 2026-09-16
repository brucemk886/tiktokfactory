import assert from "node:assert/strict";
import test from "node:test";
import { createGeminiVideoClient, extractGeminiText, GEMINI_VIDEO_MODEL, usageFromGemini } from "./gemini-video-client.js";
import { analyzeVideoWithRetry, isTransientGeminiError } from "./gemini-video-workflow.js";

test("Gemini video client uploads through Files API and analyzes with gemini-3.8-flash", async () => {
  const calls = [];
  const client = createGeminiVideoClient({
    apiKey: "test-google-key",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/upload/v1beta/files")) {
        return new Response("{}", { status: 200, headers: { "x-goog-upload-url": "https://upload.example/session" } });
      }
      if (String(url) === "https://upload.example/session") {
        return Response.json({ file: { name: "files/video-1", uri: "https://files.example/video-1", mimeType: "video/mp4", state: "PROCESSING" } });
      }
      if (String(url).endsWith("/v1beta/files/video-1") && init.method !== "DELETE") {
        return Response.json({ name: "files/video-1", uri: "https://files.example/video-1", mimeType: "video/mp4", state: "ACTIVE" });
      }
      if (String(url).includes(":generateContent")) {
        return Response.json({
          candidates: [{ content: { parts: [{ text: "结构化分析结果" }] } }],
          usageMetadata: { promptTokenCount: 321, candidatesTokenCount: 45 }
        });
      }
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`Unexpected URL ${url}`);
    }
  });

  const file = await client.upload({ body: new Uint8Array([1, 2, 3]), size: 3, mimeType: "video/mp4", displayName: "demo.mp4" });
  assert.equal(file.name, "files/video-1");
  assert.equal((await client.getFile(file.name)).state, "ACTIVE");
  const result = await client.analyze({ fileUri: file.uri, mimeType: file.mimeType, prompt: "分析这个视频" });
  await client.removeFile(file.name);

  assert.equal(extractGeminiText(result), "结构化分析结果");
  assert.deepEqual(usageFromGemini(result), { inputTokens: 321, outputTokens: 45 });
  const analysisCall = calls.find((call) => call.url.includes(":generateContent"));
  assert.match(analysisCall.url, new RegExp(`models/${GEMINI_VIDEO_MODEL}:generateContent$`));
  const body = JSON.parse(analysisCall.init.body);
  assert.equal(body.contents[0].parts[0].file_data.file_uri, "https://files.example/video-1");
  assert.equal(body.contents[0].parts[1].text, "分析这个视频");
});

test("Gemini result extraction reports blocked or empty responses", () => {
  assert.throws(() => extractGeminiText({ promptFeedback: { blockReason: "SAFETY" } }), /SAFETY/);
});

test("video analysis retries temporary high-demand failures with durable backoff", async () => {
  let calls = 0;
  const sleeps = [];
  const client = {
    async analyze() {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("This model is currently experiencing high demand. Please try again later."), { statusCode: 503 });
      return { candidates: [{ content: { parts: [{ text: "ok" }] } }] };
    }
  };
  const step = {
    async do(_name, _options, run) { return run(); },
    async sleep(name, duration) { sleeps.push({ name, duration }); }
  };
  const result = await analyzeVideoWithRetry(client, { fileUri: "file", mimeType: "video/mp4", prompt: "analyze" }, step);
  assert.equal(extractGeminiText(result), "ok");
  assert.equal(calls, 3);
  assert.deepEqual(sleeps.map((item) => item.duration), ["10 seconds", "20 seconds"]);
});

test("video analysis does not retry permanent request failures", async () => {
  let calls = 0;
  const error = Object.assign(new Error("Invalid argument"), { statusCode: 400 });
  const client = { async analyze() { calls += 1; throw error; } };
  const step = {
    async do(_name, _options, run) { return run(); },
    async sleep() { throw new Error("should not sleep"); }
  };
  await assert.rejects(() => analyzeVideoWithRetry(client, {}, step), /Invalid argument/);
  assert.equal(calls, 1);
  assert.equal(isTransientGeminiError(error), false);
});
test("Google client preserves permanent 4xx errors", async () => {
  const client = createGeminiVideoClient({
    apiKey: "test-google-key",
    fetchImpl: async () => Response.json({ error: { message: "Invalid argument" } }, { status: 400 })
  });
  await assert.rejects(
    () => client.analyze({ fileUri: "file", mimeType: "video/mp4", prompt: "analyze" }),
    (error) => error.statusCode === 400 && /Invalid argument/.test(error.message)
  );
});
