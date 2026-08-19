import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function findGitRoot(start = here) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("找不到 git 仓库，无法核对 GitHub main。");
    dir = parent;
  }
}

export function evaluateDeployAlignment({ head, remote, base }) {
  if (!head || !remote || !base) return { ok: false, reason: "missing-refs" };
  if (base !== remote) return { ok: false, reason: "behind-or-diverged" };
  if (head !== remote) return { ok: true, reason: "ahead" };
  return { ok: true, reason: "up-to-date" };
}

function git(repo, args) {
  const safeDirectory = repo.replace(/\\/g, "/");
  return execFileSync("git", ["-c", `safe.directory=${safeDirectory}`, ...args], {
    cwd: repo,
    encoding: "utf8"
  }).trim();
}

function short(value) {
  return String(value || "").slice(0, 7);
}

export function checkOriginMain(repo = findGitRoot()) {
  git(repo, ["fetch", "origin", "main"]);
  const head = git(repo, ["rev-parse", "HEAD"]);
  const remote = git(repo, ["rev-parse", "origin/main"]);
  const base = git(repo, ["merge-base", "HEAD", "origin/main"]);
  const result = evaluateDeployAlignment({ head, remote, base });
  if (!result.ok) {
    const message = result.reason === "missing-refs"
      ? "拒绝部署：读不到 origin/main。请确认已配置 GitHub 远程。"
      : `拒绝部署：本地 ${short(head)} 落后或分叉于 origin/main ${short(remote)}。请先 git pull。`;
    const error = new Error(message);
    error.code = "FACTORY_DEPLOY_REFUSED";
    throw error;
  }
  if (result.reason === "ahead") {
    console.log(`本地 ${short(head)} 比 origin/main ${short(remote)} 超前。可以部署本地已提交代码，但还没推到 GitHub。`);
  } else {
    console.log(`已与 origin/main ${short(remote)} 对齐。`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkOriginMain();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
