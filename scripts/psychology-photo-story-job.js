import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from './video-core.js';
import { resolveStorageDirs } from './storage-paths.js';
import { createKieAiService } from './kie-ai.js';
import { runPhotoStoryProduction } from './psychology-peer-production.js';

const [payloadPath, jobPath] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const config = readConfig(process.cwd());
const { workDir } = resolveStorageDirs(process.cwd(), config);
const settingsPath = path.join(workDir, 'psychology-video-settings.json');
const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
const dir = path.join(workDir, 'psychology-photo-story', String(payload.jobId).replace(/[^a-zA-Z0-9_-]/g, ''));
fs.mkdirSync(dir, { recursive: true });
function update(patch) {
  const previous = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  const next = { ...previous, ...patch, updatedAt: Date.now() };
  fs.writeFileSync(jobPath, JSON.stringify(next), 'utf8');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...next, source: payload.peerSource }, null, 2), 'utf8');
}
async function main() {
  const key = process.env.KIE_API_KEY || settings.kieApiKey || config.kieApiKey;
  if (!key) throw new Error('Kie.ai API Key 未配置。');
  const kie = createKieAiService({ workDir, readApiKey: () => key });
  update({ status: 'running', percent: 5, message: '正在改编来源文案并拆分六页图文…', results: [] });
  await runPhotoStoryProduction(payload, { kie, update(patch) {
    if (patch.plan) fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(patch.plan, null, 2), 'utf8');
    update(patch);
  } });
}
main().catch(error => { update({ status: 'failed', message: error.message, error: error.message }); process.exitCode = 1; });
