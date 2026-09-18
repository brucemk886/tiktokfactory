import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTikTokPhotoSource, validateTikTokPhotoFileUrl } from './tikhub-photo-source.js';
import { pickTikTokPhotoUrl } from '../../scripts/psychology-peer-production.js';

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

test('photo resolver keeps source order and caps a post at six images', async () => {
  const images=Array.from({length:8},(_,index)=>`https://p16-sign.tiktokcdn-us.com/${index+1}.webp`);
  const source=await resolveTikTokPhotoSource({}, {url:page,imageUrls:images});
  assert.deepEqual(source.urls,images.slice(0,6));
});

test('photo resolver prefers jpeg over heic and rewrites heic-only URLs for Kie', async () => {
  const heic = 'https://p16-common-sign.tiktokcdn-us.com/tos-useast2a-i-photomode-euttp/abc~tplv-photomode-shrink-v1:1080:0:q80.heic?dr=10956';
  const jpeg = 'https://p16-common-sign.tiktokcdn-us.com/tos-useast2a-i-photomode-euttp/abc~tplv-photomode-shrink-v1:1080:0:q80.jpeg?dr=10956';
  assert.equal(pickTikTokPhotoUrl([heic, jpeg]), jpeg);
  assert.equal(pickTikTokPhotoUrl([heic]), jpeg);
  assert.equal(pickTikTokPhotoUrl(['https://p16-common-sign.tiktokcdn-us.com/tos-useast2a-i-photomode-euttp/abc', heic]), jpeg);
  const stored = await resolveTikTokPhotoSource({ fetch() { throw new Error('unexpected'); } }, { url: page, imageUrls: [heic] });
  assert.deepEqual(stored.urls, [jpeg]);
  const source = await resolveTikTokPhotoSource({ TIKHUB_API_KEY: 'private-test', fetch: async () => Response.json({ code: 200, data: { status_code: 0, aweme_detail: {
    aweme_id: '1', images: [{ display_image: { url_list: [heic, jpeg] } }]
  } } }) }, { url: page });
  assert.deepEqual(source.urls, [jpeg]);
});

test('photo resolver rejects unsafe URLs, missing configuration and empty provider images', async () => {
  for (const value of ['http://p16.tiktokcdn.com/a.webp', 'https://127.0.0.1/a.webp', 'https://tiktokcdn.com.evil.test/a.webp']) {
    assert.throws(() => validateTikTokPhotoFileUrl(value), /TikTok/);
  }
  await assert.rejects(resolveTikTokPhotoSource({}, { url: page }), /TikHub API Key/);
  await assert.rejects(resolveTikTokPhotoSource({ TIKHUB_API_KEY: 'test', fetch: async () => Response.json({ code: 200, data: { status_code: 0, aweme_detail: { images: [] } } }) }, { url: page }), /原帖图片/);
});
