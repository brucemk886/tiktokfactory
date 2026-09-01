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

test("cloud AI rejects chat requests", async () => {
  const response = await handleAi(
    jsonRequest("POST", "/api/kie-ai", { kind: "chat", prompt: "hello" }),
    { DB: memoryAiDb(), KIE_API_KEY: "test-key", fetch: async () => json({ code: 200, data: 1 }) },
    new URL("https://factory.tiktokaitool.com/api/kie-ai"),
    adminSession()
  );
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /生图和生视频/);
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
