import assert from "node:assert/strict";
import test from "node:test";
import { handleAi } from "./ai.js";

test("admins can create and refresh a cloud Kie image task", async () => {
  const db = memoryAiDb();
  const calls = [];
  const env = {
    DB: db,
    KIE_API_KEY: "test-key",
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
      if (String(url).includes("createTask")) return json({ code: 200, data: { taskId: "remote-1" } });
      if (String(url).includes("recordInfo")) {
        return json({
          code: 200,
          data: {
            state: "success",
            progress: 100,
            resultJson: JSON.stringify({ resultUrls: ["https://cdn.example/out.png"] }),
            creditsConsumed: 2.5
          }
        });
      }
      if (String(url).includes("chat/credit")) return json({ code: 200, data: 88 });
      throw new Error(`Unexpected URL ${url}`);
    }
  };
  const created = await handleAi(jsonRequest("POST", "/api/kie-ai", {
    kind: "image",
    prompt: "A quiet lake",
    imageModel: "nano-banana",
    noImageText: true
  }), env, new URL("https://factory.tiktokaitool.com/api/kie-ai"), adminSession());
  const createdBody = await created.json();
  assert.equal(created.status, 201);
  assert.equal(createdBody.task.status, "waiting");
  assert.equal(createdBody.task.model, "google/nano-banana");
  assert.equal(calls[0].body.model, "google/nano-banana");

  const refreshed = await handleAi(
    jsonRequest("GET", `/api/kie-ai?id=${createdBody.task.id}`),
    env,
    new URL(`https://factory.tiktokaitool.com/api/kie-ai?id=${createdBody.task.id}`),
    adminSession()
  );
  const refreshedBody = await refreshed.json();
  assert.equal(refreshedBody.task.status, "success");
  assert.deepEqual(refreshedBody.task.resultUrls, ["https://cdn.example/out.png"]);
  assert.equal(refreshedBody.task.creditsConsumed, 2.5);

  const list = await handleAi(jsonRequest("GET", "/api/kie-ai"), env, new URL("https://factory.tiktokaitool.com/api/kie-ai"), adminSession());
  const listBody = await list.json();
  assert.equal(listBody.configured, true);
  assert.equal(listBody.credits, 88);
  assert.equal(listBody.tasks.length, 1);
});

test("operators cannot use the cloud AI studio", async () => {
  const response = await handleAi(
    jsonRequest("GET", "/api/kie-ai"),
    { DB: memoryAiDb(), KIE_API_KEY: "test-key" },
    new URL("https://factory.tiktokaitool.com/api/kie-ai"),
    { user: { username: "op", role: "operator" } }
  );
  assert.equal(response.status, 403);
});

test("cloud AI runs Gemini 3.8 Flash chat synchronously", async () => {
  const calls = [];
  const response = await handleAi(
    jsonRequest("POST", "/api/kie-ai", { kind: "chat", prompt: "hello" }),
    { DB: memoryAiDb(), KIE_API_KEY: "test-key", fetch: async (url, init = {}) => {
      calls.push({ url:String(url), body:JSON.parse(init.body) });
      return json({ choices:[{message:{content:"Hello from 3.8"}}], credits_consumed:0.12 });
    } },
    new URL("https://factory.tiktokaitool.com/api/kie-ai"),
    adminSession()
  );
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.task.status, "success");
  assert.equal(body.task.model, "gemini-3-8-flash");
  assert.equal(body.task.resultText, "Hello from 3.8");
  assert.equal(body.task.creditsConsumed, 0.12);
  assert.match(calls[0].url, /gemini-3-8-flash-openai\/v1\/chat\/completions$/);
});

function adminSession() {
  return { user: { username: "admin", role: "admin" } };
}

function jsonRequest(method, path, body) {
  return new Request(`https://factory.tiktokaitool.com${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
}

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function memoryAiDb() {
  const rows = new Map();
  return {
    prepare(sql) {
      const text = String(sql);
      const bound = (args = []) => ({
        async run() {
          if (/CREATE TABLE|CREATE INDEX/i.test(text)) return { meta: { changes: 0 } };
          if (/INSERT INTO factory_ai_generations/.test(text)) {
            rows.set(args[0], {
              id: args[0],
              owner_username: args[1],
              kind: args[2],
              model: args[3],
              prompt: args[4],
              status: args[5],
              task_id: args[6],
              result_urls_json: args[7],
              result_text: args[8],
              error: args[9],
              progress: args[10],
              credits_consumed: args[11],
              created_at: args[12],
              updated_at: args[13],
              completed_at: args[14]
            });
            return { meta: { changes: 1 } };
          }
          if (/UPDATE factory_ai_generations/.test(text)) {
            const current = rows.get(args[7]);
            if (!current || current.owner_username !== args[8]) return { meta: { changes: 0 } };
            rows.set(current.id, {
              ...current,
              status: args[0],
              progress: args[1],
              result_urls_json: args[2],
              error: args[3],
              credits_consumed: args[4],
              updated_at: args[5],
              completed_at: args[6]
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          const row = rows.get(args[0]);
          if (!row || row.owner_username !== args[1]) return null;
          return row;
        },
        async all() {
          return {
            results: [...rows.values()]
              .filter((row) => row.owner_username === args[0])
              .sort((a, b) => b.created_at - a.created_at)
              .slice(0, 50)
          };
        }
      });
      return {
        ...bound(),
        bind(...args) {
          return bound(args);
        }
      };
    }
  };
}


test("MiniMax video is submitted once, persisted, polled and listed with the actual model", async () => {
  const calls = [];
  const env = { DB: memoryAiDb(), KIE_API_KEY: "test-key", fetch: async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body && JSON.parse(init.body) });
    if (String(url).includes("createTask")) return json({ code: 200, data: { taskId: "minimax-1" } });
    if (String(url).includes("recordInfo")) return json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn.example/minimax.mp4"] }), creditsConsumed: 12.5 } });
    return json({ code: 200, data: 100 });
  } };
  const request = jsonRequest("POST", "/api/kie-ai", { kind: "video", videoModel: "minimax-h3", prompt: "A quiet lake", duration: "4", aspectRatio: "9:16", resolution: "768P" });
  const response = await handleAi(request, env, new URL(request.url), adminSession());
  assert.equal(response.status, 201);
  const { task } = await response.json();
  assert.equal(task.model, "minimax-h3/text-to-video");
  assert.deepEqual(calls[0].body, { model: "minimax-h3/text-to-video", input: { prompt: "A quiet lake", duration: 4, aspect_ratio: "9:16", resolution: "768P" } });
  const poll = jsonRequest("GET", `/api/kie-ai?id=${task.id}`);
  const completed = await (await handleAi(poll, env, new URL(poll.url), adminSession())).json();
  assert.equal(completed.task.status, "success");
  assert.equal(completed.task.model, "minimax-h3/text-to-video");
  assert.deepEqual(completed.task.resultUrls, ["https://cdn.example/minimax.mp4"]);
  assert.equal(completed.task.creditsConsumed, 12.5);
  await handleAi(poll, env, new URL(poll.url), adminSession());
  assert.equal(calls.filter(({ url }) => url.includes("recordInfo")).length, 1);
  const overview = jsonRequest("GET", "/api/kie-ai");
  const listed = await (await handleAi(overview, env, new URL(overview.url), adminSession())).json();
  assert.equal(listed.tasks[0].model, "minimax-h3/text-to-video");
  assert.equal(calls.filter(({ url }) => url.includes("createTask")).length, 1);
});

test("invalid video model or MiniMax settings return 400 without upstream billing", async () => {
  let requests = 0;
  const env = { DB: memoryAiDb(), KIE_API_KEY: "test-key", fetch: async () => { requests++; throw new Error("must not call"); } };
  for (const overrides of [{ videoModel: "typo" }, { duration: 16 }, { resolution: "480p" }, { aspectRatio: "2:3" }, { prompt: "a".repeat(7001) }]) {
    const request = jsonRequest("POST", "/api/kie-ai", { kind: "video", videoModel: "minimax-h3", prompt: "A quiet lake", ...overrides });
    const response = await handleAi(request, env, new URL(request.url), adminSession());
    assert.equal(response.status, 400);
  }
  assert.equal(requests, 0);
});
