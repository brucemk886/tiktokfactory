import fs from "node:fs";
import path from "node:path";
import {
  ensureProject,
  findMatchingAudio,
  readConfig,
  renderPodcastVideo
} from "./video-core.js";

const root = process.cwd();
const config = readConfig(root);
const scriptsDir = path.join(root, "input", "scripts");

ensureProject(root);

const scriptFiles = fs
  .readdirSync(scriptsDir)
  .filter((file) => file.toLowerCase().endsWith(".txt"))
  .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

if (scriptFiles.length === 0) {
  console.log("No .txt scripts found in input/scripts.");
  process.exit(0);
}

for (const scriptFile of scriptFiles) {
  const id = path.basename(scriptFile, ".txt");
  const scriptPath = path.join(scriptsDir, scriptFile);
  const scriptText = fs.readFileSync(scriptPath, "utf8").trim();
  const audioPath = findMatchingAudio(root, id, config);

  console.log(`Generating ${id}.mp4 ${audioPath ? "with audio" : "without audio"}`);
  renderPodcastVideo({ root, config, id, scriptText, audioPath });
}

console.log("Done. Videos are in outputs/.");
