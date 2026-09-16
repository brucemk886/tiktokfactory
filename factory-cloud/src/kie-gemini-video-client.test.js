import assert from "node:assert/strict";
import test from "node:test";
import { createKieGeminiVideoClient, KIE_GEMINI_VIDEO_MODEL } from "./kie-gemini-video-client.js";

test("Kie Gemini video client sends a signed video URL and returns usage", async () => {
  let call;
  const client = createKieGeminiVideoClient({
    apiKey: "kie-test-key",
    fetchImpl: async (url, init) => {
      call = { url: String(url), init };
      return Response.json({
        choices: [{ message: { content: "分镜脚本" } }],
        usage: { prompt_tokens: 12000, completion_tokens: 3200, total_tokens: 15200 },
        credits_consumed: 1.26
      });
    }
  });
  const result = await client.analyze({
    videoUrl: "https://factory.test/api/integrations/gemini-video-source/a?expires=1&signature=signed",
    prompt: "拆解视频"
  });
  assert.equal(result.text, "分镜脚本");
  assert.deepEqual(result, { text: "分镜脚本", inputTokens: 12000, outputTokens: 3200, creditsConsumed: 1.26 });
  assert.match(call.url, /gemini-3-8-flash-openai\/v1\/chat\/completions$/);
  assert.equal(call.init.headers.Authorization, "Bearer kie-test-key");
  const body = JSON.parse(call.init.body);
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].content[0].text, "拆解视频");
  assert.match(body.messages[0].content[1].image_url.url, /gemini-video-source/);
  assert.equal(KIE_GEMINI_VIDEO_MODEL, "gemini-3-8-flash");
});

test("Kie Gemini video client preserves provider errors", async () => {
  const client = createKieGeminiVideoClient({
    apiKey: "kie-test-key",
    fetchImpl: async () => Response.json({ error: { message: "rate limited" } }, { status: 429 })
  });
  await assert.rejects(
    () => client.analyze({ videoUrl: "https://factory.test/video", prompt: "analyze" }),
    (error) => error.statusCode === 429 && /rate limited/.test(error.message)
  );
});


test("Kie HTTP 200 error envelopes retain their reason without leaking keys or signed URLs", async () => {
  const client = createKieGeminiVideoClient({ apiKey: "test-secret", fetchImpl: async () => Response.json({code:422,msg:"Unsupported media https://factory.test/video?signature=private test-secret"}) });
  await assert.rejects(client.analyze({videoUrl:"https://factory.test/video",prompt:"analyze"}), error => {
    assert.equal(error.statusCode,422);
    assert.match(error.message,/Unsupported media/);
    assert.doesNotMatch(error.message,/test-secret|signature=private/);
    return true;
  });
});

test("Kie invalid JSON does not silently become an empty answer", async () => {
  const client = createKieGeminiVideoClient({ apiKey: "key", fetchImpl: async () => new Response("<html>bad gateway</html>", {status:502,headers:{"content-type":"text/html"}}) });
  await assert.rejects(client.analyze({videoUrl:"https://factory.test/video",prompt:"analyze"}), /HTTP 502.*text\/html/);
});

test("Kie wrapped responses preserve answer text and usage", async () => {
  const client = createKieGeminiVideoClient({ apiKey: "key", fetchImpl: async () => Response.json({code:200,data:{choices:[{message:{content:"plan"}}],usage:{prompt_tokens:5,completion_tokens:7}},credits_consumed:0.01}) });
  assert.deepEqual(await client.analyze({videoUrl:"https://factory.test/video",prompt:"analyze"}), {text:"plan",inputTokens:5,outputTokens:7,creditsConsumed:0.01});
});
