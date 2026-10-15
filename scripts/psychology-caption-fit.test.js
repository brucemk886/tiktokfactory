import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCaptionWithCTA, TIKTOK_CAPTION_MAX } from './psychology-caption-fit.js';
import { importedPhotoCaption } from './psychology-imported-photo-policy.js';

const cta = 'Take the test at @receiver_b.';

test('short captions get the CTA appended unchanged', () => {
  assert.deepEqual(fitCaptionWithCTA('Hello world', cta), { caption: 'Hello world\n\n' + cta, truncated: false });
  assert.deepEqual(fitCaptionWithCTA('Hello\n\n' + cta, cta), { caption: 'Hello\n\n' + cta, truncated: false });
  assert.deepEqual(fitCaptionWithCTA('', cta), { caption: cta, truncated: false });
});

test('exactly-at-limit captions are not shortened', () => {
  const base = 'a'.repeat(TIKTOK_CAPTION_MAX - 2 - cta.length);
  const r = fitCaptionWithCTA(base, cta);
  assert.equal(r.truncated, false);
  assert.equal(r.caption.length, TIKTOK_CAPTION_MAX);
});

test('overlong captions are shortened, keep the full CTA and stay within the limit', () => {
  const base = ('word '.repeat(500)).trim() + ' #psychology #attachment #healing';
  const r = fitCaptionWithCTA(base, cta);
  assert.equal(r.truncated, true);
  assert.ok(r.caption.length <= TIKTOK_CAPTION_MAX);
  assert.ok(r.caption.endsWith('…\n\n' + cta));
  assert.ok(!/\s…/.test(r.caption), 'cut happens on a word boundary without trailing space');
  assert.deepEqual(fitCaptionWithCTA(r.caption, cta), { caption: r.caption, truncated: false }, 'replay is stable');
});

test('does not split surrogate pairs (emoji) when shortening', () => {
  const r = fitCaptionWithCTA('😀'.repeat(1500), cta);
  assert.ok(r.caption.length <= TIKTOK_CAPTION_MAX);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(r.caption));
});

test('a CTA that alone cannot fit still fails clearly', () => {
  assert.throws(() => fitCaptionWithCTA('x', 'y'.repeat(TIKTOK_CAPTION_MAX)), /引导/);
});

test('imported photo captions are shortened instead of failing', () => {
  const receiver = { connectionId: 'b', username: 'receiver_b', linkReady: true };
  const r = importedPhotoCaption('x'.repeat(2199), 'a', receiver);
  assert.ok(r.caption.length <= TIKTOK_CAPTION_MAX);
  assert.ok(r.caption.endsWith(r.cta));
});
