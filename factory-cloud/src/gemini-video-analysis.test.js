import assert from "node:assert/strict";
import test from "node:test";
import { handleGeminiVideoAnalysis } from "./gemini-video-analysis.js";

test("admin creates, streams and dispatches a Gemini video analysis", async () => {
  const rows = new Map();
  const workflowCalls = [];
  const archive = {
    async put(key, body) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      return { key, size: bytes.byteLength };
    },
    async delete() {}
  };
  const env = {
    DB: memoryDb(rows),
    ARCHIVE: archive,
    GEMINI_API_KEY: "test-key",
    GEMINI_VIDEO_WORKFLOW: { async createBatch(items) { workflowCalls.push(items); } }
  };
  const session = { user: { username: "admin", role: "admin" } };
  const createRequest = new Request("https://factory.tiktokaitool.com/api/gemini-video-analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "分析开头钩子", fileName: "demo.mp4", mimeType: "video/mp4", fileSize: 3 })
  });
  const created = await handleGeminiVideoAnalysis(createRequest, env, new URL(createRequest.url), session);
  const createdBody = await created.json();
  assert.equal(created.status, 201);
  assert.equal(createdBody.task.model, "gemini-3.8-flash");
  assert.equal(createdBody.task.status, "uploading");

  const uploadRequest = new Request(`https://factory.tiktokaitool.com${createdBody.uploadUrl}`, {
    method: "PUT",
    body: new Uint8Array([1, 2, 3])
  });
  const uploaded = await handleGeminiVideoAnalysis(uploadRequest, env, new URL(uploadRequest.url), session);
  const uploadedBody = await uploaded.json();
  assert.equal(uploaded.status, 202);
  assert.equal(uploadedBody.task.status, "queued");
  assert.equal(workflowCalls.length, 1);
  assert.equal(workflowCalls[0][0].params.analysisId, createdBody.task.id);
});

test("video analysis stays admin-only", async () => {
  const request = new Request("https://factory.tiktokaitool.com/api/gemini-video-analysis");
  const response = await handleGeminiVideoAnalysis(request, {}, new URL(request.url), { user: { username: "op", role: "operator" } });
  assert.equal(response.status, 403);
});

function memoryDb(rows) {
  return {
    prepare(sql) {
      const text = String(sql);
      const build = (args = []) => ({
        async run() {
          if (/CREATE TABLE|CREATE INDEX/.test(text)) return { meta: { changes: 0 } };
          if (/INSERT INTO factory_video_analyses/.test(text)) {
            rows.set(args[0], {
              id: args[0], owner_username: args[1], model: args[2], file_name: args[3],
              mime_type: args[4], file_size: args[5], prompt: args[6], status: "uploading",
              progress: 0, result_text: "", error: "", r2_key: args[7], google_file_name: "",
              input_tokens: 0, output_tokens: 0, created_at: args[8], updated_at: args[9], completed_at: 0
            });
            return { meta: { changes: 1 } };
          }
          if (/UPDATE factory_video_analyses SET status='queued'/.test(text)) {
            const row = rows.get(args[1]);
            if (row && row.owner_username === args[2] && row.status === "uploading") Object.assign(row, { status: "queued", progress: 5, updated_at: args[0] });
            return { meta: { changes: row ? 1 : 0 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          const row = rows.get(args[0]);
          return row && row.owner_username === args[1] ? row : null;
        },
        async all() { return { results: [...rows.values()].filter((row) => row.owner_username === args[0]) }; }
      });
      return { ...build(), bind(...args) { return build(args); } };
    }
  };
}
