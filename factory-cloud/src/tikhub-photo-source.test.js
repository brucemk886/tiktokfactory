import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTikTokPhotoSource, validateTikTokPhotoFileUrl } from './tikhub-photo-source.js';

const page = 'https://www.tiktok.com/@creator/photo/7620295658553052430';
const first = 'https://p16-sign.tiktokcdn-us.com/first.webp';
const second = 'https://p19-sign.tiktokcdn-us.com/second.webp';

test('stored original photo URLs retain their order without calling TikHub', async () => {
  const source = await resolveTikTokPhotoSource({ fetch() { throw new Error('unexpected'); } }, { url: page, imageUrls: [first, second] });
  assert.deepEqual(source.urls, [first, second]);
  assert.equal(source.provider, 'stored');
});

test('TikHub photo response extracts every original image in order', async () => {
  const source = await resolveTikTokPhotoSource({ TIKHUB_API_KEY: 'private-test', fetch: async (url, init) => {
    assert.equal(new URL(url).searchParams.get('share_url'), page);
    assert.equal(init.headers.authorization, 'Bearer private-test');
    return Response.json({ code: 200, request_id: 'request-1', data: { status_code: 0, aweme_detail: {
      aweme_id: '7620295658553052430', desc: 'Original caption', images: [
        { display_image: { url_list: [first] } },
        { origin_image: { url_list: ['https://127.0.0.1/private', second] } }
      ]
    } } });
  } }, { url: page });
  assert.deepEqual(source.urls, [first, second]);
  assert.equal(source.sourceCopy, 'Original caption');
  assert.ok(!JSON.stringify(source).includes('private-test'));
});

test('photo resolver rejects unsafe URLs, missing configuration and empty provider images', async () => {
  for (const value of ['http://p16.tiktokcdn.com/a.webp', 'https://127.0.0.1/a.webp', 'https://tiktokcdn.com.evil.test/a.webp']) {
    assert.throws(() => validateTikTokPhotoFileUrl(value), /TikTok/);
  }
  await assert.rejects(resolveTikTokPhotoSource({}, { url: page }), /TikHub API Key/);
  await assert.rejects(resolveTikTokPhotoSource({ TIKHUB_API_KEY: 'test', fetch: async () => Response.json({ code: 200, data: { status_code: 0, aweme_detail: { images: [] } } }) }, { url: page }), /原帖图片/);
});
