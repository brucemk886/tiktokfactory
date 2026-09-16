import assert from "node:assert/strict";
import test from "node:test";
import { createGeminiVideoClient, extractGeminiText, GEMINI_VIDEO_MODEL, usageFromGemini } from "./gemini-video-client.js";

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
