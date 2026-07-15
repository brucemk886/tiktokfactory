import fs from "node:fs";
import path from "node:path";
import { createTikTokAnalyticsService } from "./tiktok-analytics.js";
import { resolveStorageDirs } from "./storage-paths.js";

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const { workDir } = resolveStorageDirs(root, config);
const service = createTikTokAnalyticsService({ workDir });

console.log(JSON.stringify(service.repairStore(), null, 2));
