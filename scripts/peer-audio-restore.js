const TINY_DEST_BYTES = 200 * 1024;
const MIN_SOURCE_GAIN_BYTES = 50 * 1024;
const SHORT_DEST_SECONDS = 15;
const MIN_LONG_SOURCE_BYTES = 400 * 1024;

export function shouldRestorePeerSourceAudio({ destSize = 0, sourceSize = 0, destDuration = 0 } = {}) {
  const dest = Math.max(0, Number(destSize) || 0);
  const source = Math.max(0, Number(sourceSize) || 0);
  const duration = Math.max(0, Number(destDuration) || 0);
  if (!source || source <= dest) return false;
  const destLooksTiny = dest > 0 && dest < TINY_DEST_BYTES;
  const destLooksShort = duration > 0 && duration <= SHORT_DEST_SECONDS;
  const sourceMuchBigger = source >= dest * 2 && source >= dest + MIN_SOURCE_GAIN_BYTES;
  if (destLooksTiny && sourceMuchBigger) return true;
  if (destLooksShort && source >= MIN_LONG_SOURCE_BYTES) return true;
  if (!dest && source >= MIN_LONG_SOURCE_BYTES) return true;
  return false;
}
