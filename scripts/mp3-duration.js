const BITRATE_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATE_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATE_V1 = [44100, 48000, 32000];
const SAMPLE_RATE_V2 = [22050, 24000, 16000];
const SAMPLE_RATE_V25 = [11025, 12000, 8000];

export function readMp3Duration(bytes, totalSize = 0) {
  const data = toBytes(bytes);
  if (data.byteLength < 4) return 0;
  const start = skipId3v2(data);
  const frame = readFirstMpegFrame(data, start);
  if (!frame) return 0;
  const size = Math.max(Number(totalSize) || 0, data.byteLength);
  const xingFrames = readXingFrameCount(data, frame);
  if (xingFrames > 0) return roundDuration(xingFrames * frame.samplesPerFrame / frame.sampleRate);
  if (!frame.bitrate) return 0;
  const body = Math.max(0, size - frame.offset);
  return roundDuration(body * 8 / (frame.bitrate * 1000));
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(0);
}

function skipId3v2(data) {
  if (data.byteLength < 10) return 0;
  if (data[0] !== 0x49 || data[1] !== 0x44 || data[2] !== 0x33) return 0;
  const size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f);
  return Math.min(data.byteLength, 10 + size);
}

function readFirstMpegFrame(data, from = 0) {
  for (let offset = Math.max(0, from); offset < data.byteLength - 3; offset += 1) {
    if (data[offset] !== 0xff || (data[offset + 1] & 0xe0) !== 0xe0) continue;
    const header = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
    const versionBits = (header >> 19) & 3;
    const layerBits = (header >> 17) & 3;
    const bitrateIndex = (header >> 12) & 15;
    const sampleRateIndex = (header >> 10) & 3;
    const channelMode = (header >> 6) & 3;
    if (layerBits !== 1 || versionBits === 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) continue;
    const mpeg1 = versionBits === 3;
    const mpeg25 = versionBits === 0;
    const bitrate = (mpeg1 ? BITRATE_V1_L3 : BITRATE_V2_L3)[bitrateIndex] || 0;
    const sampleRate = (mpeg1 ? SAMPLE_RATE_V1 : mpeg25 ? SAMPLE_RATE_V25 : SAMPLE_RATE_V2)[sampleRateIndex] || 0;
    if (!bitrate || !sampleRate) continue;
    return {
      offset,
      bitrate,
      sampleRate,
      samplesPerFrame: mpeg1 ? 1152 : 576,
      channels: channelMode === 3 ? 1 : 2,
      mpeg1
    };
  }
  return null;
}

function readXingFrameCount(data, frame) {
  const xingOffset = frame.offset + 4 + (frame.mpeg1 ? (frame.channels === 1 ? 17 : 32) : (frame.channels === 1 ? 9 : 17));
  if (xingOffset + 12 > data.byteLength) return 0;
  const tag = String.fromCharCode(data[xingOffset], data[xingOffset + 1], data[xingOffset + 2], data[xingOffset + 3]);
  if (tag !== "Xing" && tag !== "Info") return 0;
  const flags = (data[xingOffset + 4] << 24) | (data[xingOffset + 5] << 16) | (data[xingOffset + 6] << 8) | data[xingOffset + 7];
  if ((flags & 1) !== 1) return 0;
  return (data[xingOffset + 8] << 24) | (data[xingOffset + 9] << 16) | (data[xingOffset + 10] << 8) | data[xingOffset + 11];
}

function roundDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds * 10) / 10;
}
