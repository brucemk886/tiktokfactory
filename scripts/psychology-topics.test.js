import assert from "node:assert/strict";
import test from "node:test";
import { fetchTextWithRetry, normalizeTopics, resolveSecretInput } from "./psychology-topics.js";

test("normalizes common psychology topic API payloads", () => {
  const topics = normalizeTopics({ data: { questions: [
    { id: 7, title: "你会先看到什么？", choices: ["树", { text: "脸" }], analysis: "不同选择代表不同注意模式" }
  ] } });
  assert.equal(topics.length, 1);
  assert.equal(topics[0].id, "7");
  assert.equal(topics[0].question, "你会先看到什么？");
  assert.deepEqual(topics[0].options.map((item) => item.text), ["树", "脸"]);
});

test("deduplicates repeated topic text", () => {
  const topics = normalizeTopics({ items: ["压力大时你会做什么？", { question: "压力大时你会做什么？" }] });
  assert.equal(topics.length, 1);
});

test("normalizes DeepPersona options that store option text in label", () => {
  const topics = normalizeTopics({ items: [{
    id: "stress-1",
    prompt: "What do you notice first?",
    imageUrl: "https://example.com/test.png",
    options: [
      { label: "Ask what changed", meaning: "You prefer direct repair.", projection: "You move toward uncertainty." },
      { label: "Give them space", meaning: "You prefer room to regulate." }
    ]
  }] });

  assert.deepEqual(topics[0].options, [
    { label: "A", text: "Ask what changed" },
    { label: "B", text: "Give them space" }
  ]);
  assert.match(topics[0].answerGuide, /Ask what changed/);
  assert.match(topics[0].answerGuide, /You move toward uncertainty/);
});


test("does not replace a saved API key with browser autofill", () => {
  assert.equal(resolveSecretInput("********", "real-secret-key-value"), "real-secret-key-value");
  assert.equal(resolveSecretInput("bruce123", "real-secret-key-value"), "real-secret-key-value");
  assert.equal(resolveSecretInput("new-secret-key-value", "real-secret-key-value"), "new-secret-key-value");
});

test("retries transient fetch failures before succeeding", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    return new Response('{"items":[]}', { status: 200 });
  };
  const result = await fetchTextWithRetry(fetchImpl, "https://example.com", { attempts: 3, timeoutMs: 1_000 });
  assert.equal(calls, 3);
  assert.equal(result.raw, '{"items":[]}');
});

test("does not retry authentication errors", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('{"error":"Unauthorized"}', { status: 401 });
  };
  await assert.rejects(fetchTextWithRetry(fetchImpl, "https://example.com", { attempts: 3 }), /HTTP 401/);
  assert.equal(calls, 1);
});