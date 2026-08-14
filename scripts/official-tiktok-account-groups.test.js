import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOfficialTikTokAccountGroups, officialAccountKeys } from "./official-tiktok-account-groups.js";

test("creates groups and assigns the same account across schema and connection id", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-"));
  const service = createOfficialTikTokAccountGroups({ workDir });
  const created = service.createGroup("A组");
  assert.equal(created.groups[0].name, "A组");
  const groupId = created.groups[0].id;
  service.assignAccounts({
    accounts: [{ schema: "tiktok:connection-1", profile: { username: "zoedecker03" } }],
    groupId
  });
  const attached = service.attach({
    accounts: [
      { schema: "tiktok:connection-1", profile: { username: "zoedecker03" } },
      { connectionId: "connection-1", username: "zoedecker03" },
      { connectionId: "connection-2", username: "other" }
    ]
  });
  assert.equal(attached.accounts[0].groupName, "A组");
  assert.equal(attached.accounts[1].groupName, "A组");
  assert.equal(attached.accounts[2].groupName, "");
  assert.equal(attached.ungroupedCount, 1);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("deleting a group unassigns its accounts", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-del-"));
  const service = createOfficialTikTokAccountGroups({ workDir });
  const groupId = service.createGroup("待删").groups[0].id;
  service.assignAccounts({ accounts: [{ connectionId: "c1" }], groupId });
  service.deleteGroup(groupId);
  const attached = service.attach({ accounts: [{ connectionId: "c1" }] });
  assert.equal(attached.accounts[0].groupId, "");
  assert.deepEqual(attached.groups, []);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("normalizes tiktok schema and username aliases to one key set", () => {
  assert.deepEqual(officialAccountKeys({
    schema: "tiktok:connection-9",
    connectionId: "connection-9",
    profile: { username: "demo" }
  }).sort(), ["connection-9", "demo"]);
});
