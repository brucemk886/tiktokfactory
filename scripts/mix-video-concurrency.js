export const DEFAULT_MIX_VIDEO_CONCURRENCY = 2;
export const MAX_MIX_VIDEO_CONCURRENCY = 4;

export function resolveMixVideoConcurrency(payload = {}, options = {}) {
  if (options.parkour || options.simulator) return 1;
  const raw = payload.videoConcurrency ?? payload.mixVideoConcurrency;
  if (raw == null || raw === "") return DEFAULT_MIX_VIDEO_CONCURRENCY;
  const count = Math.floor(Number(raw));
  if (!Number.isFinite(count) || count < 1) return DEFAULT_MIX_VIDEO_CONCURRENCY;
  return Math.min(MAX_MIX_VIDEO_CONCURRENCY, count);
}

export function createLock() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(() => fn());
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}
