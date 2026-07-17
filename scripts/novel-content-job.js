import fs from "node:fs";
import { scrapeNovelMasterBooks } from "./novel-master-content.js";

const [payloadPath, jobPath] = process.argv.slice(2);
if (!payloadPath || !jobPath) throw new Error("Novel content job requires payload and job paths.");

const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
await scrapeNovelMasterBooks({ ...payload, jobPath });
