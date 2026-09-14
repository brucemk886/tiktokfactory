import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { minecraftRecordingFailure, isFatalMinecraftRecordingError, recordMinecraftFootage, recordingRequestId, minecraftBridgeDirectory, validateRecordingResult } from './minecraft-recording-client.js';
import { usesMinecraftSimulator, DEFAULT_PARKOUR_VIDEO_DIR } from './video-template.js';
import { normalizeGenerationPayload } from './auto-task-manager.js';
import { handleCompat, normalizeRedditGeneration } from '../factory-cloud/src/compat.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-minecraft-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = minecraftBridgeDirectory(root); fs.mkdirSync(directory);
  const filePath = path.join(root, 'fresh.mp4'); fs.writeFileSync(filePath, Buffer.alloc(2048));
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  const options = { root, workDir: root, key: 'task:1', seconds: 60, pollMs: 5, timeoutMs: 500, launch() {} };
  return { root, directory, filePath, write, options, id: recordingRequestId(options.key) };
}
test('cloud and local preserve automatic source, keep old template 2 directory behavior', () => {
  for (const normalize of [normalizeGenerationPayload, normalizeRedditGeneration]) {
    const value = normalize({ videoTemplate: 'parkour', parkourSource: 'simulator', videoDir: 'old', openingTitleEnabled: true, endCardEnabled: true, novelPromotionCode: '1234' });
    assert.equal(usesMinecraftSimulator(value), true);
    assert.equal(value.videoDir, '');
    assert.equal(value.openingTitleEnabled, true);
    assert.equal(value.novelPromotionCode, '1234');
    assert.equal(normalize({ videoTemplate: 'parkour' }).videoDir, DEFAULT_PARKOUR_VIDEO_DIR);
    assert.equal(usesMinecraftSimulator(normalize({ videoTemplate: 'mix', parkourSource: 'simulator' })), false);
  }
});
test('waits for new recording then accepts only QA-approved, sufficiently long files', async t => {
  const f = fixture(t); f.write('health.json', { updatedAt: Date.now() });
  let launched = false;
  const timer = setTimeout(() => {
    const request = JSON.parse(fs.readFileSync(path.join(f.directory, "requests", `${f.id}.request.json`)));
    assert.equal(request.ownerPid, process.pid);
    f.write(`${f.id}.result.json`, { status: 'done', clips: [{ id: 'new', filePath: f.filePath, duration: 65, accepted: true }] });
  }, 25); t.after(() => clearTimeout(timer));
  const clips = await recordMinecraftFootage({ ...f.options, launch() { launched = true; } });
  assert.equal(launched, false); assert.equal(clips[0].file, f.filePath);
  const result = { status: 'done', clips: [{ filePath: f.filePath, duration: 65, accepted: false }] };
  assert.throws(() => validateRecordingResult(result, 60), /质检/);
  result.clips[0].accepted = true;
  assert.throws(() => validateRecordingResult(result, 80), /时长/);
  result.clips[0].filePath = path.join(f.root, 'missing.mp4');
  assert.throws(() => validateRecordingResult(result, 60), /缺失/);
});
test('cancellation writes a cancellation signal and does not return old footage', async t => {
  const f = fixture(t);
  await assert.rejects(recordMinecraftFootage({ ...f.options, isCancelled: () => true }), { code: 'MINECRAFT_CANCELLED' });
  assert.ok(fs.existsSync(path.join(f.directory, `${f.id}.cancel`)));
});
test('disconnected simulator fails within startup bound and cancels orphan request', async t => {
  const f = fixture(t);
  await assert.rejects(recordMinecraftFootage({ ...f.options, startupTimeoutMs: 10 }), /未连接/);
  assert.ok(fs.existsSync(path.join(f.directory, `${f.id}.cancel`)));
});
test('simulator QA failure is surfaced without directory fallback', async t => {
  const f = fixture(t); f.write(`${f.id}.result.json`, { status: 'failed', error: '三次质检失败' });
  await assert.rejects(recordMinecraftFootage(f.options), /三次质检失败/);
});

test('online create accepts automatic template 2 with no video directory and enqueues the full generation payload', async () => {
  const writes = [];
  const db = { prepare(sql) {
    const statement = { bind(...args) { this.args = args; return this; }, async first() { return null; }, async all() { return { results: [] }; }, async run() { writes.push({ sql, args: this.args }); return { success: true }; } };
    return statement;
  } };
  const url = new URL('https://factory.test/api/auto-tasks');
  const response = await handleCompat(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    generation: { videoTemplate: 'parkour', parkourSource: 'simulator', audioDirs: ['audio'], totalVideos: 1, novelPromotionCode: 'TEST123', openingTitleEnabled: true, endCardEnabled: true, autoCaptions: true },
    publish: { provider: 'official', autoPublish: false }
  }) }), { DB: db }, url, { user: { username: 'test-admin', role: 'admin' } });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.task.generation.videoDir, '');
  const insert = writes.find(item => /INSERT INTO factory_jobs/.test(item.sql));
  assert.ok(insert);
  const payload = JSON.parse(insert.args[4]);
  assert.equal(payload.parkourSource, 'simulator');
  assert.equal(payload.autoCaptions, true);
  assert.equal(payload.burnNovelBadge, true);
  assert.equal(payload.novelPromotionCode, 'TEST123');
  assert.equal(payload.openingTitleEnabled, true);
});

test('item QA failures are skippable; runtime loss, disk exhaustion and cancellation stop the job', () => {
  assert.equal(isFatalMinecraftRecordingError(minecraftRecordingFailure({ status: 'failed', error: '连续三次画面质检失败' })), false);
  assert.equal(isFatalMinecraftRecordingError(minecraftRecordingFailure({ status: 'failed', error: '未检测到正在运行的 Minecraft', fatal: true })), true);
  assert.equal(isFatalMinecraftRecordingError(minecraftRecordingFailure({ status: 'failed', error: '视频盘仅剩 5 GB' })), true);
  assert.equal(isFatalMinecraftRecordingError(minecraftRecordingFailure({ status: 'failed', error: 'Minecraft 心跳超过 60 秒未更新' })), true);
  assert.equal(minecraftRecordingFailure({ status: 'cancelled' }).code, 'MINECRAFT_CANCELLED');
  assert.equal(isFatalMinecraftRecordingError(new Error('No space left on device')), true);
});
