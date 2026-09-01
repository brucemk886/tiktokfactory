import assert from "node:assert/strict";
import test from "node:test";
import {
  isD1QueryInternalError,
  migrationFilesInDiff,
  shouldContinueDeployAfterMigrationFailure,
  applyRemoteMigrations
} from "./apply-remote-migrations.mjs";

test("D1 query 7500 is treated as Cloudflare's internal query outage", () => {
  assert.equal(isD1QueryInternalError("internal error; reference = e_Gz3hrU_abc [code: 7500]"), true);
  assert.equal(isD1QueryInternalError("Authentication error [code: 10000]"), false);
});

test("only SQL files inside migrations count as schema changes", () => {
  assert.deepEqual(migrationFilesInDiff("factory-cloud/migrations/0015_new.sql\npublic/app.js"), [
    "factory-cloud/migrations/0015_new.sql"
  ]);
  assert.deepEqual(migrationFilesInDiff("scripts/codex-brain.js"), []);
});

test("deploy may continue when D1 query is down and this release has no new migrations", () => {
  assert.equal(shouldContinueDeployAfterMigrationFailure({
    errorText: "internal error; reference = e_1 [code: 7500]",
    head: "bbb",
    lastMigrationCommit: "aaa",
    migrationDiff: ""
  }), true);
  assert.equal(shouldContinueDeployAfterMigrationFailure({
    errorText: "internal error; reference = e_1 [code: 7500]",
    head: "aaa",
    lastMigrationCommit: "aaa",
    migrationDiff: ""
  }), false);
  assert.equal(shouldContinueDeployAfterMigrationFailure({
    errorText: "internal error; reference = e_1 [code: 7500]",
    head: "bbb",
    lastMigrationCommit: "aaa",
    migrationDiff: "factory-cloud/migrations/0015_new.sql"
  }), false);
  assert.equal(shouldContinueDeployAfterMigrationFailure({
    errorText: "Authentication error [code: 10000]",
    head: "bbb",
    lastMigrationCommit: "aaa",
    migrationDiff: ""
  }), false);
});

test("apply retries 7500 then continues when there is no newer migration", () => {
  let attempts = 0;
  const result = applyRemoteMigrations({
    apply: () => {
      attempts += 1;
      return { status: 1, stdout: "", stderr: "internal error; reference = e_1 [code: 7500]" };
    },
    wait: () => {}
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(attempts, 5);
});
