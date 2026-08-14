import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAICompatibleModelProvider } from "./brain-model-provider.js";

test("OpenAI-compatible provider forwards structured output without changing brain logic", async () => {
  let request = null;
  const provider = createOpenAICompatibleModelProvider({
    endpoint: "https://models.example/v1/chat/completions",
    apiKey: "secret",
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }], usage: { total_tokens: 12 } }), { status: 200 });
    }
  });
  const result = await provider.run({
    model: "future-model",
    reasoningEffort: "medium",
    prompt: "diagnose",
    outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }
  });

  assert.equal(request.url, "https://models.example/v1/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer secret");
  assert.equal(request.body.model, "future-model");
  assert.equal(request.body.response_format.type, "json_schema");
  assert.equal(result.finalResponse, "{\"ok\":true}");
});
