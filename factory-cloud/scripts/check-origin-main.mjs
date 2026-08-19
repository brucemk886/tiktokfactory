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

export function evaluateDeployAlignment({ head, remote, branch, dirty }) {
  if (!head || !remote) return { ok: false, reason: "missing-refs" };
  if (branch !== "main") return { ok: false, reason: "non-main" };
  if (dirty) return { ok: false, reason: "dirty" };
  if (head !== remote) return { ok: false, reason: "not-synchronized" };
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
  const branch = git(repo, ["branch", "--show-current"]);
  const dirty = Boolean(git(repo, ["status", "--porcelain", "--untracked-files=all"]));
  const result = evaluateDeployAlignment({ head, remote, branch, dirty });
  if (!result.ok) {
    const messages = {
      "missing-refs": "拒绝部署：读不到 origin/main。请确认已配置 GitHub 远程。",
      "non-main": `拒绝部署：当前分支是 ${branch || "detached HEAD"}，生产发布必须从 main 执行。`,
      dirty: "拒绝部署：工作区存在未提交或未跟踪文件。请先明确提交或清理。",
      "not-synchronized": `拒绝部署：本地 ${short(head)} 与 origin/main ${short(remote)} 不一致。请先同步 GitHub。`
    };
    const message = messages[result.reason] || "拒绝部署：GitHub 同步状态异常。";
    const error = new Error(message);
    error.code = "FACTORY_DEPLOY_REFUSED";
    throw error;
  }
  console.log(`GitHub main 已同步且工作区干净：${short(remote)}。可以部署。`);
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
