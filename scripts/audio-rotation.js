import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Every mix task used to start at audio #0 of the (alphabetically sorted)
// folder, so a folder of 91 stories rendered 32 at a time never got past the
// first 32. This keeps one cursor per audio-folder selection on the worker and
// hands each task the next window, so consecutive tasks walk through the whole
// folder before wrapping. The cursor is advanced when the window is reserved,
// not when the task finishes, so two render lanes running the same folders in
// parallel get disjoint windows.

export const AUDIO_ROTATION_FILE = "audio-rotation.json";
const MAX_KEYS = 500;

export function audioRotationKey(dirs = []) {
  const normalized = normalizeDirs(dirs);
  if (!normalized.length) return "";
  return crypto.createHash("sha1").update(normalized.join("\n")).digest("hex").slice(0, 16);
}

function normalizeDirs(dirs) {
  return (Array.isArray(dirs) ? dirs : [dirs])
    .map((dir) => String(dir || "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase())
    .filter(Boolean)
    .sort();
}

function readState(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeState(file, state) {
  const entries = Object.entries(state)
    .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0))
    .slice(0, MAX_KEYS);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries), null, 2));
  fs.renameSync(tmp, file);
}

// Returns the offset this task should start at and moves the cursor past the
// window it will consume. `count` is how many videos the task will render;
// `audioCount` is how many audio files the selection currently has (the cursor
// is taken modulo that, so adding files does not reset the walk).
export function reserveAudioRotation({ workDir, dirs, audioCount, count, now = Date.now() }) {
  const key = audioRotationKey(dirs);
  const total = Math.max(0, Math.floor(Number(audioCount) || 0));
  const wanted = Math.max(0, Math.floor(Number(count) || 0));
  if (!workDir || !key || !total) return { offset: 0, reserved: false, key };
  const file = path.join(workDir, AUDIO_ROTATION_FILE);
  const state = readState(file);
  const current = state[key] && typeof state[key] === "object" ? state[key] : {};
  const offset = ((Math.floor(Number(current.cursor) || 0) % total) + total) % total;
  state[key] = {
    dirs: normalizeDirs(dirs).slice(0, 50),
    cursor: (offset + wanted) % total,
    audioCount: total,
    lastOffset: offset,
    lastCount: wanted,
    updatedAt: now
  };
  writeState(file, state);
  return { offset, reserved: true, key, cursor: state[key].cursor };
}
