import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTikTokVideoSource } from './tikhub-video-source.js';
import { downloadTikTokToR2 } from './tiktok-video-download.js';

const page = 'https://www.tiktok.com/@creator/video/7620295658553052430';
const cdn = 'https://v16m.tiktokcdn-us.com/test.mp4';
function mp4(size = 2048) {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  return bytes;
}
function api(video = { play_addr_h264: { url_list: [cdn] } }) {
  return Response.json({ code: 200, request_id: 'request-1', data: { status_code: 0, aweme_detail: { aweme_id: '7620295658553052430', video } } });
}
function archive() {
  const writes = [], deletes = [], parts = [], aborted = [];
  return { writes, deletes, parts, aborted,
    async put(key, body) { writes.push(key); return { size: body.byteLength }; },
    async delete(key) { deletes.push(key); },
    async createMultipartUpload(key) {
      return {
        async uploadPart(partNumber, bytes) { parts.push(bytes.byteLength); return { partNumber, etag: String(partNumber) }; },
        async complete(items) { assert.equal(items.length, parts.length); writes.push(key); return { size: parts.reduce((a, b) => a + b, 0) }; },
        async abort() { aborted.push(key); }
      };
    }
  };
}
const args = { url: page, r2Key: 'temporary/test.mp4', jobId: 'test' };

test('share link resolution uses the configured key only at TikHub and prefers safe H264 URLs', async () => {
  let calls = 0;
  const source = await resolveTikTokVideoSource({ TIKHUB_API_KEY: 'private-test', fetch: async (url, init) => {
    calls++;
    assert.equal(new URL(url).origin, 'https://api.tikhub.io');
    assert.equal(new URL(url).searchParams.get('share_url'), page);
    assert.equal(init.headers.authorization, 'Bearer private-test');
    assert.match(init.headers['user-agent'], /Mozilla/);
    assert.equal(init.redirect, 'manual');
    return api({ play_addr_h264: { url_list: ['https://127.0.0.1/private', cdn, cdn] }, play_addr: { url_list: ['https://v16.tiktokcdn.com/other.mp4'] } });
  } }, { url: page });
  assert.equal(calls, 1);
  assert.equal(source.provider, 'tikhub');
  assert.equal(source.urls[0], cdn);
  assert.equal(source.urls.length, 2);
  assert.ok(!JSON.stringify(source).includes('private-test'));
});

test('invalid source URLs and missing configuration do not call TikHub', async () => {
  const env = { fetch() { throw new Error('Unexpected request'); } };
  for (const url of ['https://127.0.0.1', 'https://tiktok.com.evil.test/a', 'https://user:pass@www.tiktok.com/a', 'http://www.tiktok.com/a', 'invalid']) {
    await assert.rejects(resolveTikTokVideoSource(env, { url }), /TikTok/);
  }
  await assert.rejects(resolveTikTokVideoSource(env, { url: page }), /TikHub API Key/);
});

test('provider errors and unavailable videos are reported without copying secrets or response bodies', async () => {
  const responses = [
    () => new Response('private-test', { status: 401 }),
    () => new Response('private-test', { status: 402 }),
    () => new Response('private-test', { status: 429 }),
    () => Response.json({ code: 500, message: 'private-test' }),
    () => Response.json({ code: 200, data: { aweme_detail: null } }),
    () => Response.json(null),
    () => new Response('<html>private-test</html>'),
    () => api({ play_addr: { url_list: ['https://localhost/a'] } })
  ];
  for (const response of responses) {
    await assert.rejects(resolveTikTokVideoSource({ TIKHUB_API_KEY: 'private-test', fetch: async () => response() }, { url: page }), error => {
      assert.ok(!error.message.includes('private-test'));
      return true;
    });
  }
});

test('oversized provider response is rejected even without Content-Length', async () => {
  await assert.rejects(resolveTikTokVideoSource({ TIKHUB_API_KEY: 'test', fetch: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }, { url: page }), /大小异常/);
});

test('page-only downloads resolve once, try another CDN and never forward the API key', async () => {
  let parses = 0, downloads = 0;
  const ARCHIVE = archive();
  const result = await downloadTikTokToR2({ TIKHUB_API_KEY: 'private-test', ARCHIVE, fetch: async (url, init) => {
    if (url.startsWith('https://api.tikhub.io/')) {
      parses++;
      return api({ play_addr: { url_list: ['https://v16.tiktokcdn.com/expired.mp4', cdn] } });
    }
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.redirect, 'manual');
    downloads++;
    if (downloads === 1) return new Response('expired', { status: 403 });
    return new Response(mp4(), { headers: { 'content-type': 'video/mp4', 'content-length': '2048' } });
  } }, args);
  assert.equal(parses, 1);
  assert.equal(downloads, 2);
  assert.equal(result.size, 2048);
  assert.equal(result.provider, 'tikhub');
  assert.equal(ARCHIVE.writes.length, 1);
});

test('CDN redirects are validated before following and valid redirects work', async () => {
  const ARCHIVE = archive();
  let calls = 0;
  const env = { ARCHIVE, fetch: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }); } };
  await assert.rejects(downloadTikTokToR2(env, { ...args, videoFileUrl: cdn }), /HTTPS 视频文件地址/);
  assert.equal(calls, 1);
  env.fetch = async url => url === cdn
    ? new Response(null, { status: 302, headers: { location: 'https://v16.tiktokcdn.com/final.mp4' } })
    : new Response(mp4(), { headers: { 'content-type': 'video/mp4' } });
  assert.equal((await downloadTikTokToR2(env, { ...args, videoFileUrl: cdn })).size, 2048);
});

test('partial, oversized, fake MP4 and HTML downloads cannot reach analysis storage', async () => {
  for (const response of [
    () => new Response(mp4(), { status: 206, headers: { 'content-type': 'video/mp4' } }),
    () => new Response(mp4(), { headers: { 'content-type': 'video/mp4', 'content-length': '4096' } }),
    () => new Response(mp4(), { headers: { 'content-type': 'video/mp4', 'content-length': String(301 * 1024 * 1024) } }),
    () => new Response(new Uint8Array(2048), { headers: { 'content-type': 'video/mp4' } }),
    () => new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } })
  ]) {
    const ARCHIVE = archive();
    await assert.rejects(downloadTikTokToR2({ ARCHIVE, fetch: async () => response() }, { ...args, videoFileUrl: cdn }));
    assert.equal(ARCHIVE.writes.length, 0);
  }
});

test('downloads larger than 8 MB use bounded multipart writes', async () => {
  const ARCHIVE = archive(), size = 9 * 1024 * 1024 + 3;
  const result = await downloadTikTokToR2({ ARCHIVE, fetch: async () => new Response(mp4(size), { headers: { 'content-type': 'video/mp4' } }) }, { ...args, videoFileUrl: cdn });
  assert.equal(result.size, size);
  assert.deepEqual(ARCHIVE.parts, [8 * 1024 * 1024, 1024 * 1024 + 3]);
  assert.equal(ARCHIVE.aborted.length, 0);
});

test('interrupted downloads abort multipart uploads and remove partial objects', async () => {
  const ARCHIVE = archive();
  let reads = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (reads++ === 0) controller.enqueue(mp4(8 * 1024 * 1024));
      else controller.error(new Error('network interrupted'));
    }
  });
  await assert.rejects(downloadTikTokToR2({ ARCHIVE, fetch: async () => new Response(body, { headers: { 'content-type': 'video/mp4' } }) }, { ...args, videoFileUrl: cdn }), /network interrupted/);
  assert.deepEqual(ARCHIVE.aborted, [args.r2Key]);
  assert.ok(ARCHIVE.deletes.includes(args.r2Key));
  assert.equal(ARCHIVE.writes.length, 0);
});


test('TikHub API redirects are rejected without forwarding the credential', async () => {
  let requests = 0;
  await assert.rejects(resolveTikTokVideoSource({ TIKHUB_API_KEY: 'private-test', fetch: async (_, init) => {
    requests++;
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://other.example/' } });
  } }, { url: page }), /HTTP 302/);
  assert.equal(requests, 1);
});
