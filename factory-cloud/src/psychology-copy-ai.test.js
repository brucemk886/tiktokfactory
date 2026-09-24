import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { handlePsychologyCreative } from './psychology-creative.js';
import { replicateText } from './replicate.js';

const user = { id: 'admin', username: 'admin', role: 'admin', sidebarModules: ['psychology-publish'] };
const api = (f, path, method = 'POST') => { const url = new URL('https://factory.test/api/psychology-creative' + path); return handlePsychologyCreative(new Request(url, { method }), f.env, url, { user }); };
const version = n => ({ name: '版本' + n, title: 'When their silence gets loud ' + n, caption: 'Be honest, does this sound like you? #attachment', pages: ['When their silence gets loud ' + n, 'You reread the chat hoping it says something new ' + n] });

test('Replicate client waits, polls until done, joins streamed output and reports failures', async () => {
  const calls = [];
  const env = { REPLICATE_API_TOKEN: 'r8_test', fetch: async (url, init = {}) => {
    calls.push({ url, init });
    if (init.method === 'POST') return Response.json({ status: 'processing', urls: { get: 'https://api.replicate.com/v1/predictions/p1' } }, { status: 201 });
    return Response.json(calls.length < 3 ? { status: 'processing', urls: { get: 'https://api.replicate.com/v1/predictions/p1' } } : { status: 'succeeded', output: ['{"a"', ':1}'] });
  } };
  assert.equal(await replicateText(env, { model: 'anthropic/claude-sonnet-5', prompt: 'hi', maxTokens: 100 }, { sleep: async () => {} }), '{"a":1}');
  assert.equal(calls[0].url, 'https://api.replicate.com/v1/models/anthropic/claude-sonnet-5/predictions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer r8_test');
  assert.equal(calls[0].init.headers.Prefer, 'wait=60');
  assert.deepEqual(JSON.parse(calls[0].init.body).input, { prompt: 'hi', system_prompt: '', max_tokens: 1024, effort: 'low' });
  assert.equal(calls.length, 3);
  await assert.rejects(replicateText({}, { model: 'm', prompt: 'x' }), e => e.statusCode === 503 && /REPLICATE_API_TOKEN/.test(e.message));
  await assert.rejects(replicateText({ REPLICATE_API_TOKEN: 't', fetch: async () => Response.json({ status: 'failed', error: 'bad input' }) }, { model: 'm', prompt: 'x' }), /bad input/);
  await assert.rejects(replicateText({ REPLICATE_API_TOKEN: 't', fetch: async () => Response.json({ detail: 'Unauthenticated' }, { status: 401 }) }, { model: 'm', prompt: 'x' }), /401.*Unauthenticated/);
  let clock = 0;
  await assert.rejects(replicateText({ REPLICATE_API_TOKEN: 't', fetch: async () => Response.json({ status: 'starting', urls: { get: 'g' } }) }, { model: 'm', prompt: 'x' }, { sleep: async () => { clock += 60000; }, now: () => clock }), e => e.statusCode === 504);
});

async function aiFixture(t, output) {
  const f = await fixture(t);
  f.env.REPLICATE_API_TOKEN = 'r8_test';
  const prompts = [];
  f.env.fetch = async (url, init) => { const body = JSON.parse(init.body); prompts.push({ url, body }); return Response.json({ status: 'succeeded', output: [typeof output === 'function' ? output(body) : output] }); };
  const row = f.sqlite.prepare("SELECT id FROM psychology_copy_library WHERE media_type='photo' LIMIT 1").get();
  f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',content_json=? WHERE id=?").run(JSON.stringify({ title: 'Source', caption: 'stored original', pages: [{ text: 'First original page text here' }, { text: 'Second original page text here' }] }), row.id);
  return { ...f, row, prompts };
}

test('single AI draft uses the chosen Replicate model and rejects unknown models', async t => {
  const f = await aiFixture(t, JSON.stringify(version(1)));
  const data = await (await api(f, '/copies/generate?sourceId=' + f.row.id + '&model=claude-sonnet-5')).json();
  assert.equal(data.model, 'claude-sonnet-5');
  assert.equal(data.draft.title, version(1).title);
  assert.equal(f.prompts[0].url, 'https://api.replicate.com/v1/models/anthropic/claude-sonnet-5/predictions');
  assert.match(f.prompts[0].body.input.prompt, /Create ONE fresh/);
  assert.match(f.prompts[0].body.input.prompt, /stored original/);
  await assert.rejects(api(f, '/copies/generate?sourceId=' + f.row.id + '&model=gpt-9'), /不支持这个模型/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_variants').get().n, 0);
});

test('batch AI rewrite saves passing versions enabled under the source and skips ones failing the gate', async t => {
  const copied = { ...version(3), pages: ['A new cover line', 'First original page text here'] };
  const f = await aiFixture(t, body => JSON.stringify({ versions: [version(1), version(2), copied, { ...version(4), pages: ['only one page'] }, version(5)] }));
  const data = await (await api(f, '/copies/generate-batch?sourceId=' + f.row.id + '&model=claude-opus-4.7&count=5')).json();
  assert.equal(f.prompts[0].url, 'https://api.replicate.com/v1/models/anthropic/claude-opus-4.7/predictions');
  assert.match(f.prompts[0].body.input.prompt, /Create 5 distinct/);
  assert.equal(data.created, 3);
  assert.equal(data.skipped.length, 2);
  assert.ok(data.skipped.some(s => /照抄了原文/.test(s)));
  assert.ok(data.skipped.some(s => /页数不符合/.test(s)));
  const rows = f.sqlite.prepare('SELECT owner,external_id,source_key,enabled FROM psychology_copy_variants ORDER BY external_id').all();
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.owner === 'admin' && r.enabled === 1 && r.external_id.startsWith('ai-claude-opus-4.7-') && r.source_key.startsWith('v1:tiktok:')));
  // Resending the same output is a no-op; a line already used by this post is not a template.
  assert.equal((await (await api(f, '/copies/generate-batch?sourceId=' + f.row.id + '&model=claude-opus-4.7&count=5')).json()).created, 3);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_variants').get().n, 3);
  const tooMany = await api(f, '/copies/generate-batch?sourceId=' + f.row.id + '&count=6');
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).error, /1–5/);
});

test('model output wrapped in a code fence or a sentence still parses', async t => {
  const f = await aiFixture(t, 'Here are your rewrites:\n```json\n' + JSON.stringify({ versions: [version(1), version(2)] }) + '\n```\nHope this helps!');
  assert.equal((await (await api(f, '/copies/generate-batch?sourceId=' + f.row.id + '&model=claude-sonnet-5&count=2')).json()).created, 2);
});

test('batch AI rewrite fails clearly when nothing usable comes back or the key is missing', async t => {
  const f = await aiFixture(t, 'not json');
  await assert.rejects(api(f, '/copies/generate-batch?sourceId=' + f.row.id + '&model=claude-sonnet-5&count=2'), /格式无效/);
  delete f.env.REPLICATE_API_TOKEN;
  await assert.rejects(api(f, '/copies/generate-batch?sourceId=' + f.row.id + '&model=claude-sonnet-5&count=2'), e => e.statusCode === 503);
});
