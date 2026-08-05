import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFivetranTikTokService } from "./fivetran-tiktok.js";

function createWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "local-factory-fivetran-"));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
}

test("Fivetran settings mask credentials and keep secrets outside public output", () => {
  const workDir = createWorkDir();
  const service = createFivetranTikTokService({ workDir, fetchImpl: async () => jsonResponse({}) });
  const settings = service.saveSettings({
    apiKey: "example-api-key-1234",
    apiSecret: "example-secret-5678",
    appPublicUrl: "http://192.168.1.10:3010",
    syncFrequency: 60
  });
  assert.equal(settings.configured, true);
  assert.equal(settings.maskedApiKey, "exam...1234");
  assert.equal(settings.hasApiSecret, true);
  assert.equal(JSON.stringify(settings).includes("example-secret-5678"), false);
});

test("Fivetran discovery uses Basic auth and returns likely TikTok Organic connections", async () => {
  const workDir = createWorkDir();
  const requests = [];
  const service = createFivetranTikTokService({
    workDir,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("/v1/groups")) return jsonResponse({ items: [{ id: "group-1", name: "Production" }] });
      return jsonResponse({ items: [{ id: "conn-1", group_id: "group-1", service: "tiktok_organic_app", schema: "tiktok_main" }] });
    }
  });
  service.saveSettings({ apiKey: "key-1", apiSecret: "secret-1" });
  const result = await service.discover();
  assert.equal(result.groups.length, 1);
  assert.equal(result.likelyTikTokConnections.length, 1);
  assert.match(requests[0].options.headers.Authorization, /^Basic /);
  assert.equal(requests[0].options.headers.Accept, "application/json;version=2");
});

test("Connect Card URL is returned but never persisted", async () => {
  const workDir = createWorkDir();
  const requests = [];
  const service = createFivetranTikTokService({
    workDir,
    now: () => 1_700_000_000_000,
    fetchImpl: async (url, options) => {
      const pathname = new URL(String(url)).pathname;
      requests.push({ pathname, options });
      if (pathname === "/v1/connections/template-1") {
        return jsonResponse({ id: "template-1", group_id: "group-1", service: "tiktok_organic_app", destination_schema_names: "FIVETRAN_NAMING", config: { schema: "template_schema", region: "US" } });
      }
      if (pathname === "/v1/connections") {
        return jsonResponse({ id: "created-connection", status: { setup_state: "incomplete", sync_state: "scheduled" } });
      }
      if (pathname.endsWith("/connect-card")) {
        return jsonResponse({ connect_card: { uri: "https://fivetran.example/connect/one-time-secret" } });
      }
      throw new Error(`Unexpected request: ${pathname}`);
    }
  });
  service.saveSettings({
    apiKey: "key-1",
    apiSecret: "secret-1",
    groupId: "group-1",
    templateConnectionId: "template-1",
    appPublicUrl: "http://192.168.1.10:3010"
  });
  const integration = await service.createIntegration({ ownerUserId: "user-1", ownerUsername: "admin", displayName: "Account 01", idempotencyKey: "request-1" });
  const card = await service.createConnectCard(integration.id);
  assert.equal(card.connectCardUrl, "https://fivetran.example/connect/one-time-secret");
  const persisted = fs.readFileSync(path.join(workDir, "fivetran-tiktok-integrations.json"), "utf8");
  assert.equal(persisted.includes("one-time-secret"), false);
  const createBody = JSON.parse(requests.find((item) => item.pathname === "/v1/connections").options.body);
  assert.equal(createBody.config.region, "US");
  assert.match(createBody.config.schema, /^tiktok_org_admin_/);
  const connectCardBody = JSON.parse(requests.find((item) => item.pathname.endsWith("/connect-card")).options.body);
  assert.deepEqual(connectCardBody, {
    connect_card_config: {
      redirect_uri: `http://192.168.1.10:3010/tiktok-connections/callback?integrationId=${encodeURIComponent(integration.id)}`,
      hide_setup_guide: true
    }
  });
});

test("Repeated create request with the same idempotency key does not create twice", async () => {
  const workDir = createWorkDir();
  let createCount = 0;
  const service = createFivetranTikTokService({
    workDir,
    fetchImpl: async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname === "/v1/connections/template-1") return jsonResponse({ id: "template-1", group_id: "group-1", service: "tiktok_organic_app", config: { schema: "template" } });
      if (pathname === "/v1/connections") {
        createCount += 1;
        return jsonResponse({ id: `created-${createCount}`, status: { setup_state: "incomplete" } });
      }
      throw new Error(`Unexpected request: ${pathname}`);
    }
  });
  service.saveSettings({ apiKey: "key", apiSecret: "secret", groupId: "group-1", templateConnectionId: "template-1" });
  const first = await service.createIntegration({ ownerUserId: "user-1", ownerUsername: "admin", idempotencyKey: "same-request" });
  const second = await service.createIntegration({ ownerUserId: "user-1", ownerUsername: "admin", idempotencyKey: "same-request" });
  assert.equal(first.id, second.id);
  assert.equal(createCount, 1);
});

test("renames an authorization record without changing its Fivetran connection", async () => {
  const workDir = createWorkDir();
  const service = createFivetranTikTokService({
    workDir,
    fetchImpl: async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname === "/v1/connections/template-1") return jsonResponse({ id: "template-1", group_id: "group-1", service: "tiktok_organic_app", config: { schema: "template" } });
      if (pathname === "/v1/connections") return jsonResponse({ id: "connection-1", status: { setup_state: "incomplete" } });
      throw new Error(`Unexpected request: ${pathname}`);
    }
  });
  service.saveSettings({ apiKey: "key", apiSecret: "secret", groupId: "group-1", templateConnectionId: "template-1" });
  const created = await service.createIntegration({ ownerUserId: "user-1", ownerUsername: "admin", displayName: "TikTok 01" });
  const renamed = service.renameIntegration(created.id, "@focus_daily", "user-1");
  assert.equal(renamed.displayName, "@focus_daily");
  assert.equal(renamed.fivetranConnectionId, "connection-1");
});
