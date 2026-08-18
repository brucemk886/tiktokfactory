import assert from "node:assert/strict";
import test from "node:test";
import { scopeOfficialAccess, userAllowedGroupIds } from "./official-account-group-store.js";

const store = {
  projects: [
    { id: "proj-mid", name: "中视频", moduleKey: "mid-video" },
    { id: "proj-psych", name: "心理学", moduleKey: "psychology" },
  ],
  groups: [
    { id: "g-mid-a", name: "中视频A", projectId: "proj-mid" },
    { id: "g-mid-b", name: "中视频B", projectId: "proj-mid" },
    { id: "g-psy", name: "心理A", projectId: "proj-psych" },
  ],
  assignments: {
    "acc-mid-a": "g-mid-a",
    "acc-mid-b": "g-mid-b",
    "acc-psy": "g-psy",
  },
};

const accounts = [
  { connectionId: "acc-mid-a", username: "mida" },
  { connectionId: "acc-mid-b", username: "midb" },
  { connectionId: "acc-psy", username: "psy" },
];

test("admin sees every group in the current module", () => {
  const scoped = scopeOfficialAccess({ accounts }, store, { role: "admin", allowedAccountGroups: [] }, "mid-video");
  assert.equal(scoped.groups.length, 2);
  assert.deepEqual(scoped.accounts.map((item) => item.connectionId).sort(), ["acc-mid-a", "acc-mid-b"]);
  assert.equal(userAllowedGroupIds({ role: "admin" }), null);
});

test("operator only sees assigned groups in the current module", () => {
  const user = { role: "operator", allowedAccountGroups: ["g-mid-a", "g-psy"] };
  const mid = scopeOfficialAccess({ accounts }, store, user, "mid-video");
  assert.deepEqual(mid.groups.map((item) => item.id), ["g-mid-a"]);
  assert.deepEqual(mid.accounts.map((item) => item.connectionId), ["acc-mid-a"]);
  const psych = scopeOfficialAccess({ accounts }, store, user, "psychology");
  assert.deepEqual(psych.accounts.map((item) => item.connectionId), ["acc-psy"]);
});

test("operator with no groups sees nothing", () => {
  const scoped = scopeOfficialAccess({ accounts }, store, { role: "operator", allowedAccountGroups: [] }, "mid-video");
  assert.deepEqual(scoped.groups, []);
  assert.deepEqual(scoped.accounts, []);
});

test("group accountCount counts one account even when aliases are stored twice", () => {
  const assigned = {
    ...store,
    assignments: {
      "acc-mid-a": "g-mid-a",
      mida: "g-mid-a",
      "acc-mid-b": "g-mid-b",
      midb: "g-mid-b",
    },
  };
  const hydrated = scopeOfficialAccess({ accounts }, assigned, { role: "admin" }, "mid-video");
  assert.equal(hydrated.groups.find((item) => item.id === "g-mid-a")?.accountCount, 1);
  assert.equal(hydrated.groups.find((item) => item.id === "g-mid-b")?.accountCount, 1);
});
