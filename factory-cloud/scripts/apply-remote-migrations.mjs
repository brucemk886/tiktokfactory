import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findGitRoot } from "./check-origin-main.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const APPLY_ATTEMPTS = 5;
const APPLY_DELAYS_MS = [3_000, 6_000, 12_000, 20_000];

export function isD1QueryInternalError(text) {
  const message = String(text || "");
  return /\[code:\s*7500\]/.test(message) || /internal error; reference =/i.test(message);
}

export function migrationFilesInDiff(nameOnlyOutput) {
  return String(nameOnlyOutput || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter((line) => /(?:^|\/)migrations\/.+\.sql$/i.test(line));
}

export function shouldContinueDeployAfterMigrationFailure({ errorText, head, lastMigrationCommit, migrationDiff }) {
  if (!isD1QueryInternalError(errorText)) return false;
  if (!head || !lastMigrationCommit || head === lastMigrationCommit) return false;
  return migrationFilesInDiff(migrationDiff).length === 0;
}

function git(repo, args) {
  const safeDirectory = repo.replace(/\\/g, "/");
  return execFileSync("git", ["-c", `safe.directory=${safeDirectory}`, ...args], {
    cwd: repo,
    encoding: "utf8"
  }).trim();
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runMigrationApply() {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(command, [
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "factory-prod",
    "--remote",
    "--config",
    "wrangler.jsonc"
  ], {
    cwd: path.resolve(here, ".."),
    encoding: "utf8"
  });
}

export function applyRemoteMigrations({
  repo = findGitRoot(),
  apply = runMigrationApply,
  wait = sleep
} = {}) {
  let last = { status: 1, stdout: "", stderr: "未执行远程迁移。" };
  for (let attempt = 1; attempt <= APPLY_ATTEMPTS; attempt += 1) {
    last = apply();
    const output = `${last.stdout || ""}\n${last.stderr || ""}`;
    if ((last.status ?? 1) === 0) {
      console.log(output.trim());
      return { ok: true, skipped: false, attempts: attempt };
    }
    console.error(output.trim());
    if (!isD1QueryInternalError(output) || attempt === APPLY_ATTEMPTS) break;
    const delay = APPLY_DELAYS_MS[attempt - 1] || 20_000;
    console.error(`D1 管理查询 7500，${delay / 1000} 秒后重试（${attempt}/${APPLY_ATTEMPTS}）。`);
    wait(delay);
  }

  const output = `${last.stdout || ""}\n${last.stderr || ""}`;
  const head = git(repo, ["rev-parse", "HEAD"]);
  const lastMigrationCommit = git(repo, ["log", "-1", "--format=%H", "--", "factory-cloud/migrations"]);
  const migrationDiff = git(repo, ["diff", "--name-only", lastMigrationCommit, "HEAD", "--", "factory-cloud/migrations"]);
  if (shouldContinueDeployAfterMigrationFailure({
    errorText: output,
    head,
    lastMigrationCommit,
    migrationDiff
  })) {
    console.error("D1 管理查询仍是 7500，但这次发布没有新的数据库迁移，继续部署 Worker。");
    return { ok: true, skipped: true, attempts: APPLY_ATTEMPTS };
  }

  const error = new Error("远程 D1 迁移核对失败，已停止部署。");
  error.code = "FACTORY_D1_APPLY_FAILED";
  throw error;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    applyRemoteMigrations();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
