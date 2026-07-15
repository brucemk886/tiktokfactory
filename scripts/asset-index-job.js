import fs from "node:fs";
import path from "node:path";
import { reindexAssetGroup } from "./asset-library.js";

const payloadPath = process.argv[2];
const jobPath = process.argv[3];
const root = process.cwd();

main().catch((error) => {
  patchJob({ status: "failed", percent: 100, message: error.message || "素材索引更新失败。", updatedAt: Date.now() });
  process.exitCode = 1;
});

function main() {
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const result = reindexAssetGroup(root, String(payload.groupId || ""), {
    onProgress: ({ processed, total, fileName }) => {
      patchJob({
        status: "running",
        percent: Math.min(99, Math.max(1, Math.round(processed / Math.max(1, total) * 100))),
        message: `正在建立索引 ${processed}/${total}：${fileName}`,
        processed,
        total,
        updatedAt: Date.now()
      });
    }
  });
  patchJob({
    status: "done",
    percent: 100,
    message: `索引已更新：扫描 ${result.scanned} 条，可用 ${result.indexed} 条。`,
    result,
    updatedAt: Date.now()
  });
}

function patchJob(patch) {
  const current = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8")) : {};
  fs.writeFileSync(jobPath, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}
