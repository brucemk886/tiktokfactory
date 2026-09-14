import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {preparePsychologyRenderAssets} from './psychology-render-assets.js';

test('isolated render public directory contains every production SVG without unrelated files', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'psychology-assets-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  fs.writeFileSync(path.join(temp, 'narration.mp3'), 'existing audio');
  preparePsychologyRenderAssets(root, temp);
  for (let i=1; i<=8; i++) {
    const file = `stick-${String(i).padStart(2,'0')}.svg`;
    assert.deepEqual(fs.readFileSync(path.join(temp,'psychology-poses',file)), fs.readFileSync(path.join(root,'public','psychology-poses',file)));
  }
  assert.equal(fs.readFileSync(path.join(temp,'narration.mp3'),'utf8'), 'existing audio');
  assert.deepEqual(fs.readdirSync(temp).sort(), ['narration.mp3','psychology-poses']);
  assert.throws(() => preparePsychologyRenderAssets(temp, path.join(temp,'missing')), /缺少动画素材/);
  assert.equal(fs.existsSync(path.join(temp,'missing')), false);
});
