import assert from "node:assert/strict";
import test from "node:test";
import { runGeminiVideoWorkflow } from "./gemini-video-workflow.js";

test("video workflow falls back to Kie after Google high-demand retries", async () => {
  const row = {
    id: "analysis-1", owner_username: "admin", model: "gemini-3.8-flash", file_name: "demo.mp4",
    mime_type: "video/mp4", file_size: 3, prompt: "拆解脚本和分镜", status: "queued", progress: 5,
    result_text: "", error: "", r2_key: "gemini-video/demo.mp4", google_file_name: "",
    input_tokens: 0, output_tokens: 0, provider: "google", provider_credits: 0
  };
  const calls = [];
  const sleeps = [];
  let googleAnalysisCalls = 0;
  let deletedR2 = false;
  const env = {
    GEMINI_API_KEY: "google-key",
    KIE_API_KEY: "kie-key",
    FACTORY_PUBLIC_BASE_URL: "https://factory.test",
    DB: memoryWorkflowDb(row),
    ARCHIVE: {
      async get() { return { body: new Uint8Array([1, 2, 3]) }; },
      async delete() { deletedR2 = true; }
    },
    fetch: async (url, init = {}) => {
      const target = String(url);
      calls.push({ url: target, init });
      if (target.endsWith("/upload/v1beta/files")) {
        return new Response("{}", { status: 200, headers: { "x-goog-upload-url": "https://upload.test/session" } });
      }
      if (target === "https://upload.test/session") {
        return Response.json({ file: { name: "files/video-1", uri: "https://google.test/video-1", mimeType: "video/mp4", state: "PROCESSING" } });
      }
      if (target.endsWith("/v1beta/files/video-1") && init.method !== "DELETE") {
        return Response.json({ name: "files/video-1", uri: "https://google.test/video-1", mimeType: "video/mp4", state: "ACTIVE" });
      }
      if (target.includes(":generateContent")) {
        googleAnalysisCalls += 1;
        return Response.json({ error: { message: "This model is currently experiencing high demand. Please try again later." } }, { status: 503 });
      }
      if (target.includes("/gemini-3-8-flash-openai/v1/chat/completions")) {
        return Response.json({
          choices: [{ message: { content: "Kie 返回的分镜脚本" } }],
          usage: { prompt_tokens: 12000, completion_tokens: 3000 },
          credits_consumed: 1.2
        });
      }
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`Unexpected URL: ${target}`);
    }
  };
  const step = {
    async do(_name, options, run) {
      const action = typeof options === "function" ? options : run;
      return action();
    },
    async sleep(name, duration) { sleeps.push({ name, duration }); }
  };

  const result = await runGeminiVideoWorkflow(env, { payload: { analysisId: row.id } }, step);

  assert.equal(googleAnalysisCalls, 3);
  assert.deepEqual(sleeps.map((item) => item.duration), ["10 seconds", "20 seconds"]);
  assert.equal(result.provider, "kie");
  assert.equal(result.creditsConsumed, 1.2);
  assert.equal(row.status, "success");
  assert.equal(row.provider, "kie");
  assert.equal(row.provider_credits, 1.2);
  assert.equal(row.result_text, "Kie 返回的分镜脚本");
  assert.equal(deletedR2, true);
  const kieCall = calls.find((call) => call.url.includes("gemini-3-8-flash-openai"));
  const body = JSON.parse(kieCall.init.body);
  const videoUrl = body.messages[0].content[1].image_url.url;
  assert.match(videoUrl, /^https:\/\/factory\.test\/api\/integrations\/gemini-video-source\/analysis-1\?/);
  assert.match(videoUrl, /signature=[0-9a-f]{64}/);
});

function memoryWorkflowDb(row) {
  return {
    prepare(sql) {
      const text = String(sql);
      const build = (args = []) => ({
        async first() { return /SELECT \*/.test(text) && args[0] === row.id ? row : null; },
        async run() {
          if (/UPDATE factory_video_analyses SET/.test(text)) {
            Object.assign(row, {
              status: args[0], progress: args[1], result_text: args[2], error: args[3],
              google_file_name: args[4], input_tokens: args[5], output_tokens: args[6],
              provider: args[7], provider_credits: args[8], updated_at: args[9], completed_at: args[10]
            });
          }
          return { meta: { changes: 1 } };
        }
      });
      return { ...build(), bind(...args) { return build(args); } };
    }
  };
}
