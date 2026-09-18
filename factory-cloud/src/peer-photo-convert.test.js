import test from 'node:test';
import assert from 'node:assert/strict';
import { convertImageBytes, createKiePhotoSourceUrl, handleKiePhotoSource, loadPeerPhotoChatImages, preparePeerPhotosForKie, sniffImageFormat } from './peer-photo-convert.js';

function jpegBytes() {
  const bytes = new Uint8Array(16);
  bytes.set([0xFF, 0xD8, 0xFF, 0xE0]);
  return bytes;
}

function heicBytes() {
  const bytes = new Uint8Array(16);
  bytes[3] = 12;
  bytes.set(new TextEncoder().encode('ftypheic'), 4);
  return bytes;
}

function archive() {
  const objects = new Map();
  return {
    objects,
    async put(key, value) { objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value)); },
    async get(key) { const bytes = objects.get(key); return bytes ? { body: bytes, size: bytes.length } : null; },
    async head(key) { const bytes = objects.get(key); return bytes ? { size: bytes.length } : null; },
    async delete(key) { objects.delete(key); }
  };
}

test('sniffs jpeg and heic magic bytes', () => {
  assert.equal(sniffImageFormat(jpegBytes()), 'jpeg');
  assert.equal(sniffImageFormat(heicBytes()), 'heic');
});

test('converts HEIC bytes to JPEG before they can be sent to Kie', async () => {
  const converted = await convertImageBytes(heicBytes(), { heicToJpeg: async () => jpegBytes() });
  assert.equal(converted.format, 'jpeg');
  assert.equal(converted.converted, true);
  assert.equal(sniffImageFormat(converted.bytes), 'jpeg');
});

test('downloads HEIC, transcodes via jpeg rewrite, then serves a signed jpeg URL', async () => {
  const heic = 'https://p16-common-sign.tiktokcdn-us.com/photo~tplv-photomode-shrink-v1:1080:0:q80.heic';
  const jpeg = 'https://p16-common-sign.tiktokcdn-us.com/photo~tplv-photomode-shrink-v1:1080:0:q80.jpeg';
  const fetched = [];
  const env = {
    KIE_API_KEY: 'kie-secret',
    FACTORY_PUBLIC_BASE_URL: 'https://factory.test',
    ARCHIVE: archive(),
    async fetch(url) {
      fetched.push(String(url));
      if (String(url) === jpeg) return new Response(jpegBytes(), { headers: { 'content-type': 'image/jpeg' } });
      if (String(url) === heic) return new Response(heicBytes(), { headers: { 'content-type': 'image/heic' } });
      throw new Error('unexpected ' + url);
    }
  };
  const prepared = await preparePeerPhotosForKie(env, 'job-1', [heic]);
  assert.equal(fetched[0], jpeg);
  assert.match(prepared.urls[0], /^https:\/\/factory\.test\/api\/integrations\/kie-photo-source\/job-1\/0\.jpeg\?/);
  const now = Date.now();
  const response = await handleKiePhotoSource(new Request(prepared.urls[0]), env, new URL(prepared.urls[0]), now);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpegBytes());
});

test('decodes leftover HEIC when the jpeg rewrite is still HEIC', async () => {
  const heic = 'https://p16-common-sign.tiktokcdn-us.com/photo~tplv-photomode-shrink-v1:1080:0:q80.heic';
  let decoded = 0;
  const env = {
    KIE_API_KEY: 'kie-secret',
    FACTORY_PUBLIC_BASE_URL: 'https://factory.test',
    ARCHIVE: archive(),
    async fetch() { return new Response(heicBytes(), { headers: { 'content-type': 'image/heic' } }); }
  };
  const prepared = await preparePeerPhotosForKie(env, 'job-2', [heic], {
    heicToJpeg: async (bytes) => {
      decoded += 1;
      assert.equal(sniffImageFormat(bytes), 'heic');
      return jpegBytes();
    }
  });
  assert.equal(decoded, 1);
  assert.match(prepared.urls[0], /\/0\.jpeg\?/);
});

test('signed photo source rejects a tampered signature', async () => {
  const now = Date.UTC(2026, 8, 18, 3, 0, 0);
  const url = await createKiePhotoSourceUrl({
    baseUrl: 'https://factory.test', jobId: 'job-3', index: 0, ext: 'jpeg', secret: 'kie-secret', expiresAt: now + 60000
  });
  const env = { KIE_API_KEY: 'kie-secret', ARCHIVE: archive() };
  const tampered = new URL(url);
  tampered.searchParams.set('signature', '00');
  assert.equal((await handleKiePhotoSource(new Request(tampered), env, tampered, now)).status, 401);
});

test('loads converted R2 photos as inline Gemini data URLs', async () => {
  const store = archive();
  await store.put('psychology-photo-story-sources/job-4/0.jpeg', jpegBytes());
  const env = { ARCHIVE: store };
  const images = await loadPeerPhotoChatImages(env, {
    keys: ['psychology-photo-story-sources/job-4/0.jpeg'],
    urls: ['https://factory.test/api/integrations/kie-photo-source/job-4/0.jpeg']
  });
  assert.equal(images.length, 1);
  assert.match(images[0], /^data:image\/jpeg;base64,/);
  assert.equal(Buffer.from(images[0].slice(images[0].indexOf(',') + 1), 'base64').equals(Buffer.from(jpegBytes())), true);
});

test('photo source answers CORS preflight', async () => {
  const response = await handleKiePhotoSource(
    new Request('https://factory.test/api/integrations/kie-photo-source/job-5/0.jpeg', { method: 'OPTIONS' }),
    { KIE_API_KEY: 'kie-secret', ARCHIVE: archive() },
    new URL('https://factory.test/api/integrations/kie-photo-source/job-5/0.jpeg')
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});
