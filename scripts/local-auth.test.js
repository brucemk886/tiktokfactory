import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalAuthService } from "./local-auth.js";

test("stores sidebar visibility per account and filters modules by role", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-auth-sidebar-"));
  try {
    const auth = createLocalAuthService({ workDir });
    const admin = auth.setupAdmin({
      username: "admin",
      password: "password123",
      displayName: "Admin"
    });
    assert.ok(admin.sidebarModules.includes("operator-third-party"));
    assert.ok(admin.sidebarModules.includes("operator-official"));
    assert.ok(admin.sidebarModules.includes("novel-effects"));
    assert.ok(admin.sidebarModules.includes("geelark-novel-effects"));
    assert.ok(admin.sidebarModules.includes("geelark-tasks"));
    assert.ok(admin.sidebarModules.includes("novel-library"));
    assert.ok(!admin.sidebarModules.includes("novel-rewrite"));
    assert.ok(!admin.sidebarModules.includes("rewrite-records"));
    assert.ok(admin.sidebarModules.includes("hub"));
    assert.ok(admin.sidebarModules.includes("podcast"));
    assert.ok(!admin.sidebarModules.includes("audio-library"));
    assert.ok(!admin.sidebarModules.includes("project-hub"));
    assert.ok(admin.sidebarModules.includes("accounts"));

    const operator = auth.createUser({
      username: "operator",
      password: "password123",
      displayName: "Operator",
      role: "operator",
      geelarkProfileId: "default",
      sidebarModules: ["geelark-tasks", "analytics", "accounts"]
    });
    assert.deepEqual(operator.sidebarModules, ["geelark-tasks", "analytics"]);

    const updated = auth.updateUser(operator.id, {
      ...operator,
      sidebarModules: []
    });
    assert.deepEqual(updated.sidebarModules, []);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("strips hub from existing operator accounts", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-auth-operator-hub-"));
  try {
    const storePath = path.join(workDir, "local-accounts.json");
    fs.writeFileSync(storePath, JSON.stringify({
      version: 15,
      users: [{
        id: "op-1",
        username: "member",
        displayName: "Member",
        role: "operator",
        active: true,
        sidebarModules: ["hub", "geelark-tasks", "analytics", "stats"]
      }],
      geelarkProfiles: [{ id: "default", name: "默认 GeeLark 账号" }]
    }), "utf8");

    const auth = createLocalAuthService({ workDir });
    assert.deepEqual(auth.listUsers()[0].sidebarModules, ["geelark-tasks", "analytics", "stats"]);
    assert.ok(!auth.listUsers()[0].sidebarModules.includes("hub"));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("keeps all role-compatible sidebar modules for existing accounts", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-auth-sidebar-legacy-"));
  try {
    const auth = createLocalAuthService({ workDir });
    auth.setupAdmin({
      username: "admin",
      password: "password123",
      displayName: "Admin"
    });
    const storePath = path.join(workDir, "local-accounts.json");
    const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
    delete store.users[0].sidebarModules;
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");

    const [admin] = auth.listUsers();
    assert.ok(admin.sidebarModules.includes("psychology"));
    assert.ok(admin.sidebarModules.includes("tasks"));
    assert.ok(admin.sidebarModules.includes("accounts"));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("sidebar-only updates do not change the account role or active state", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-auth-sidebar-partial-"));
  try {
    const auth = createLocalAuthService({ workDir });
    const admin = auth.setupAdmin({
      username: "admin",
      displayName: "Admin",
      password: "password123"
    });

    const updated = auth.updateUser(admin.id, { sidebarModules: ["tasks", "accounts"] });
    assert.equal(updated.role, "admin");
    assert.equal(updated.active, true);
    assert.deepEqual(updated.sidebarModules, ["tasks", "accounts"]);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("adds new admin modules to existing sidebars once", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-auth-sidebar-migration-"));
  try {
    const storePath = path.join(workDir, "local-accounts.json");
    fs.writeFileSync(storePath, JSON.stringify({
      version: 1,
      users: [{
        id: "admin-1",
        username: "admin",
        displayName: "Admin",
        role: "admin",
        active: true,
        sidebarModules: ["tasks", "accounts"]
      }],
      geelarkProfiles: []
    }), "utf8");

    const auth = createLocalAuthService({ workDir });
    assert.deepEqual(auth.listUsers()[0].sidebarModules, ["hub", "mid-video", "podcast", "novel-library", "tasks", "tiktok-connections", "official-analytics", "official-publish-records", "geelark-tasks", "geelark-novel-effects", "accounts"]);

    auth.updateUser("admin-1", { sidebarModules: ["tasks", "accounts"] });
    const reloaded = createLocalAuthService({ workDir });
    assert.deepEqual(reloaded.listUsers()[0].sidebarModules, ["tasks", "accounts"]);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
