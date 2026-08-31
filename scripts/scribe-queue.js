import { isPlaceholderUploadedScript } from "./novel-audio-import.js";

export const SCRIBE_QUEUE_LOCK_KEY = "scribe-queue-lock";
export const SCRIBE_QUEUE_LOCK_MS = 15 * 60 * 1000;
export const SCRIBE_STALE_RUNNING_MS = 15 * 60 * 1000;
export const SCRIBE_QUEUE_CONCURRENCY = 3;
export const IMPORTED_TRANSCRIPT_PASS_KEY = "imported-transcript-pass-v1";
export const TRANSCRIPT_QUEUE_PAUSED = true;

export function scribeLockKey(slot = 0) {
  const index = Math.max(0, Math.min(SCRIBE_QUEUE_CONCURRENCY - 1, Number(slot) || 0));
  return index === 0 ? SCRIBE_QUEUE_LOCK_KEY : `${SCRIBE_QUEUE_LOCK_KEY}-${index}`;
}

export function isImportedSpeechSource(script = {}) {
  const source = String(script.sourceType || "");
  return source === "peer-hit" || source === "uploaded-audio";
}

export function hasSuccessfulImportedTranscript(script = {}) {
  return script.transcriptStatus === "ready"
    && !isPlaceholderUploadedScript(script.text)
    && String(script.text || "").trim().length >= 20;
}

export function needsQueuedSpeechTranscript(script = {}) {
  if (!isImportedSpeechSource(script)) return false;
  const audioId = String(script.audioId || script.audio?.id || "").trim();
  if (!audioId) return false;
  if (script.transcriptStatus === "running") return false;
  if (script.transcriptStatus === "failed") return false;
  if (hasSuccessfulImportedTranscript(script)) return false;
  return isPlaceholderUploadedScript(script.text)
    || script.transcriptStatus === "pending"
    || !String(script.text || "").trim();
}

export function shouldEnqueueExistingImportedTranscript(script = {}, now = Date.now()) {
  if (!isImportedSpeechSource(script)) return false;
  const audioId = String(script.audioId || script.audio?.id || "").trim();
  if (!audioId) return false;
  if (script.transcriptStatus === "running" && !isStaleTranscriptRun(script, now)) return false;
  return !hasSuccessfulImportedTranscript(script);
}

export function enqueueExistingImportedTranscripts(scripts = [], now = Date.now()) {
  const ids = [];
  const stamp = new Date(now).toISOString();
  for (const script of Array.isArray(scripts) ? scripts : []) {
    if (!shouldEnqueueExistingImportedTranscript(script, now)) continue;
    script.transcriptStatus = "pending";
    script.transcriptError = "";
    script.updatedAt = stamp;
    ids.push(script.id);
  }
  return ids;
}

export function requeueStaleTranscriptRuns(scripts = [], now = Date.now()) {
  const ids = [];
  const stamp = new Date(now).toISOString();
  for (const script of Array.isArray(scripts) ? scripts : []) {
    if (!isImportedSpeechSource(script) || !isStaleTranscriptRun(script, now)) continue;
    script.transcriptStatus = "pending";
    script.transcriptError = "";
    script.updatedAt = stamp;
    ids.push(script.id);
  }
  return ids;
}

export function requeueRunningTranscriptRuns(scripts = [], now = Date.now()) {
  const ids = [];
  const stamp = new Date(now).toISOString();
  for (const script of Array.isArray(scripts) ? scripts : []) {
    if (!isImportedSpeechSource(script) || String(script.transcriptStatus || "") !== "running") continue;
    script.transcriptStatus = "pending";
    script.transcriptError = "";
    script.updatedAt = stamp;
    ids.push(script.id);
  }
  return ids;
}

export function isStaleTranscriptRun(script = {}, now = Date.now(), staleMs = SCRIBE_STALE_RUNNING_MS) {
  if (String(script.transcriptStatus || "") !== "running") return false;
  const updated = Date.parse(script.updatedAt || "") || 0;
  return updated > 0 && now - updated >= staleMs;
}

export function pickNextQueuedTranscript(scripts = [], now = Date.now(), concurrency = SCRIBE_QUEUE_CONCURRENCY) {
  const list = Array.isArray(scripts) ? scripts : [];
  const max = Math.max(1, Number(concurrency) || SCRIBE_QUEUE_CONCURRENCY);
  const liveRunning = list.filter((script) => (
    isImportedSpeechSource(script)
    && script.transcriptStatus === "running"
    && !isStaleTranscriptRun(script, now)
  ));
  if (liveRunning.length >= max) return { busy: true, script: liveRunning[0], running: liveRunning.length };
  const next = list.find((script) => needsQueuedSpeechTranscript(script))
    || list.find((script) => isImportedSpeechSource(script) && isStaleTranscriptRun(script, now))
    || null;
  if (!next && liveRunning.length) return { busy: true, script: liveRunning[0], running: liveRunning.length };
  return { busy: false, script: next, running: liveRunning.length };
}

export function summarizeTranscriptQueue(scripts = [], now = Date.now()) {
  const list = (Array.isArray(scripts) ? scripts : []).filter(isImportedSpeechSource);
  return {
    pending: list.filter((script) => needsQueuedSpeechTranscript(script)).length,
    running: list.filter((script) => script.transcriptStatus === "running" && !isStaleTranscriptRun(script, now)).length,
    failed: list.filter((script) => script.transcriptStatus === "failed").length
  };
}
