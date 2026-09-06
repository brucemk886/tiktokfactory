import fs from "node:fs";
import { syncAssetLibraryRoot } from "./asset-library.js";

const payloadPath = process.argv[2];
const jobPath = process.argv[3];
const root = process.cwd();

main().catch((error) => {
  patchJob({ status: "failed", percent: 100, message: error.message || "素材总库同步失败。", updatedAt: Date.now() });
  process.exitCode = 1;
});

function main() {
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const skipEmpty = payload.skipEmpty === true;
  const action = skipEmpty ? "更新索引" : "同步素材组";
  const result = syncAssetLibraryRoot(root, String(payload.libraryRoot || ""), {
    skipEmpty,
    onProgress: ({ groupName, completedGroups, totalGroups, processed, total, fileName }) => {
      const withinGroup = total ? processed / total : 0;
      const percent = Math.min(99, Math.max(1, Math.round(((completedGroups + withinGroup) / Math.max(1, totalGroups)) * 100)));
      const progress = total ? `${processed}/${total}` : `${completedGroups}/${totalGroups}`;
      patchJob({
        status: "running",
        percent,
        message: `${action} ${groupName}（${progress}）${fileName ? `：${fileName}` : ""}`,
        updatedAt: Date.now()
      });
    }
  });
  const skipped = (result.groups || []).filter((item) => item.skipped).length;
  const indexed = (result.groups || []).filter((item) => !item.skipped).length;
  patchJob({
    status: "done",
    percent: 100,
    message: skipEmpty
      ? `全部文件夹索引完成：${indexed} 个素材组${skipped ? `，跳过 ${skipped} 个空目录` : ""}。`
      : `素材总库同步完成：${result.groupCount} 个账号组。`,
    result,
    updatedAt: Date.now()
  });
}

function patchJob(patch) {
  const current = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8")) : {};
  fs.writeFileSync(jobPath, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}
