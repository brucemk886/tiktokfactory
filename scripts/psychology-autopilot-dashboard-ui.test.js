import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../public/psychology-autopilot.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/psychology-autopilot.css', import.meta.url), 'utf8');

test('project dashboard leads the page, while legacy execution history is collapsed by default', () => {
 const root = html.indexOf('id="poolDashboard"');
 const execution = html.match(/<details\b([^>]*id="executionDetails"[^>]*)>([\s\S]*?)<dialog id="dashDialog"/);
 assert.ok(root > 0);
 assert.ok(execution, 'the preserved execution content has a native disclosure');
 assert.ok(root < html.indexOf('id="executionDetails"'));
 assert.doesNotMatch(execution[1], /\bopen(?:\s|=|$)/);
 assert.match(execution[2], /<summary>执行明细与历史/);
 for (const id of ['period','overview','productionCapacity','freshness','taskGroupCards','taskGroupMemberTable','attention','compare','pilots','openCreate','openPoolSwitch']) {
  assert.ok(execution[2].includes(`id="${id}"`), `${id} stays in execution details`);
 }
 assert.ok(html.indexOf('id="openTaskGroupConfig"') < root, 'project settings remains directly reachable');
 assert.ok(html.indexOf('id="reload"') < root, 'refresh remains directly reachable');
});

test('dashboard addition preserves a unique DOM target for every existing control and accessible status/dialog', () => {
 const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
 assert.equal(new Set(ids).size, ids.length, 'duplicated controls would break the existing listeners');
 for (const id of ['taskGroupDialog','createDialog','poolSwitchDialog','scheduleDialog','pauseDialog','confirmPause','saveTaskGroups','saveSchedule','createForm','confirmPoolSwitch']) {
  assert.ok(ids.includes(id), `${id} is still present`);
 }
 assert.match(html, /<section[^>]*id="poolDashboard"[^>]*aria-label="[^"]+"[^>]*aria-busy="true"/);
 assert.match(html, /id="status"[^>]*role="status"/);
 assert.match(html, /<dialog[^>]*id="dashDialog"[^>]*aria-labelledby="dashDialogTitle"/);
 assert.match(html, /<script type="module" src="\/psychology-autopilot-dashboard\.js"><\/script>/);
 assert.match(html, /<script type="module" src="\/psychology-autopilot\.js[^\"]*"><\/script>/);
});

test('mobile dashboard contains tables rather than clipping the whole page, with stacked pools and readable forms', () => {
 assert.match(css, /#poolDashboard \.dash-table-wrap\{[^}]*max-width:100%[^}]*overflow:auto/);
 assert.match(css, /@media\(max-width:850px\)\{[\s\S]*?\.dash-dual-pools\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css, /@media\(max-width:520px\)\{[\s\S]*?\.dash-list-toolbar :is\(input,select\)\{width:100%;font-size:16px/);
 assert.doesNotMatch(css, /(?:html|body)\s*\{[^}]*overflow-x\s*:\s*hidden/);
 assert.equal([...css].filter(c => c === '{').length, [...css].filter(c => c === '}').length, 'appended style chunks must retain balanced rules');
});
