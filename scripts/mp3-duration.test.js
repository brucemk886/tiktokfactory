import assert from "node:assert/strict";
import test from "node:test";
import { readMp3Duration } from "./mp3-duration.js";

function writeHeader(view, offset, { bitrateIndex = 9, sampleRateIndex = 0, mono = false } = {}) {
  // MPEG-1 Layer III, 128kbps, 44100, no padding
  const header = 0xffe00000
    | (3 << 19)
    | (1 << 17)
    | (1 << 16)
    | (bitrateIndex << 12)
    | (sampleRateIndex << 10)
    | ((mono ? 3 : 0) << 6);
  view.setUint32(offset, header);
}

test("reads VBR duration from a Xing frame count", () => {
  const bytes = new Uint8Array(80);
  const view = new DataView(bytes.buffer);
  writeHeader(view, 0);
  bytes.set(Array.from("Xing").map((ch) => ch.charCodeAt(0)), 36);
  bytes[39 + 4] = 0;
  bytes[40 + 3] = 1;
  view.setUint32(44, 100);
  assert.equal(readMp3Duration(bytes), Math.round(100 * 1152 / 44100 * 10) / 10);
});

test("falls back to CBR size when Xing is missing", () => {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  writeHeader(view, 0);
  const size = 128000 / 8 * 60;
  assert.equal(readMp3Duration(bytes, size), 60);
});

test("skips an ID3v2 tag before the first frame", () => {
  const bytes = new Uint8Array(40);
  bytes.set([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 10]);
  const view = new DataView(bytes.buffer);
  writeHeader(view, 20);
  assert.ok(readMp3Duration(bytes, 16000) > 0);
});
