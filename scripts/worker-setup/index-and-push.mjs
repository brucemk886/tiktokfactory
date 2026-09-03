// Index every sub-folder of assetLibraryRoot as an asset group, then push this
// machine's asset groups and audio folders to the factory so the task form can
// offer them under this worker. Works on any worker, not just the second one.
//
//   node scripts/worker-setup/index-and-push.mjs [--skip-index]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncAssetLibraryRoot } from "../asset-library.js";
import { pushAssetGroups, pushAudioGroups } from "../factory-cloud-worker.js";
import { readConfig } from "../video-core.js";
import { parseArgs } from "./bootstrap-worker.mjs";

export async function indexAndPush({ root = process.cwd(), skipIndex = false, log = console.log } = {}) {
  const config = readConfig(root);
  if (!skipIndex) {
    if (!config.assetLibraryRoot) throw new Error("config.json 里没有 assetLibraryRoot。");
    let lastLine = "";
    const result = syncAssetLibraryRoot(root, config.assetLibraryRoot, {
      onProgress: ({ groupName, completedGroups, totalGroups, processed, total }) => {
        const line = `[${completedGroups + 1}/${totalGroups}] ${groupName} ${processed}/${total}`;
        if (line !== lastLine && (processed === total || processed % 25 === 0)) {
          lastLine = line;
          log(line);
        }
      }
    });
    log(`素材索引完成：${result.groupCount} 个素材组。`);
  }
  const assets = await pushAssetGroups({ root });
  log(`已推送 ${assets.folders} 个素材组到工厂云。`);
  const audios = await pushAudioGroups({ root });
  log(`已推送 ${audios.groups?.length ?? audios.folders ?? 0} 个音频文件夹到工厂云（${audios.libraryRoot}）。`);
  return { assets, audios };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  indexAndPush({ root, skipIndex: args.skipIndex === true }).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
