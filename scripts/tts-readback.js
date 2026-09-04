import fs from "node:fs";
import path from "node:path";

// The mix job already transcribes every narration with ElevenLabs to burn
// captions. Comparing that transcript with the script we sent to TTS catches
// mangled names, skipped paragraphs and garbled app names for free.

// Measured on real Kokoro renders the transcript drifts 0.3–3 % from the
// script, so 15 % is far above STT noise and well below a mangled read.
export const DEFAULT_MAX_WORD_ERROR_RATE = 0.15;
export const TTS_READBACK_FILE = "tts-readback.json";
const MAX_WORDS = 4000;
const MAX_LOG_ENTRIES = 500;

const NUMBER_WORDS = Object.freeze({
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20"
});

export function normalizeSpeechText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => NUMBER_WORDS[word] || word)
    .slice(0, MAX_WORDS);
}

// Classic word-level Levenshtein distance divided by reference length.
export function wordErrorRate(reference, hypothesis) {
  const ref = Array.isArray(reference) ? reference : normalizeSpeechText(reference);
  const hyp = Array.isArray(hypothesis) ? hypothesis : normalizeSpeechText(hypothesis);
  if (!ref.length) return hyp.length ? 1 : 0;
  let previous = Array.from({ length: hyp.length + 1 }, (_, index) => index);
  for (let i = 1; i <= ref.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= hyp.length; j += 1) {
      const substitution = previous[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[hyp.length] / ref.length;
}

export function checkTtsReadback({ scriptText, transcript, maxWordErrorRate = DEFAULT_MAX_WORD_ERROR_RATE } = {}) {
  const reference = normalizeSpeechText(scriptText);
  const hypothesis = normalizeSpeechText(transcriptText(transcript));
  if (!reference.length || !hypothesis.length) {
    return { checked: false, ok: true, wer: null, referenceWords: reference.length, hypothesisWords: hypothesis.length };
  }
  const wer = wordErrorRate(reference, hypothesis);
  const limit = Math.max(0, Math.min(1, Number(maxWordErrorRate) || DEFAULT_MAX_WORD_ERROR_RATE));
  return {
    checked: true,
    ok: wer <= limit,
    wer: Math.round(wer * 1000) / 1000,
    limit,
    referenceWords: reference.length,
    hypothesisWords: hypothesis.length
  };
}

export function transcriptText(transcript) {
  if (!transcript) return "";
  if (typeof transcript === "string") return transcript;
  if (typeof transcript.text === "string" && transcript.text.trim()) return transcript.text;
  const cues = Array.isArray(transcript.cues) ? transcript.cues : Array.isArray(transcript) ? transcript : [];
  return cues.map((cue) => String(cue?.text || "")).join(" ");
}

// Keeps the last few hundred failures so a human can listen to the audio and
// fix the script or the voice. Appends, atomic write.
export function recordTtsReadbackFailure(workDir, entry) {
  if (!workDir) return;
  const file = path.join(workDir, TTS_READBACK_FILE);
  let state = { failures: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && Array.isArray(parsed.failures)) state = parsed;
  } catch {
    state = { failures: [] };
  }
  const audioPath = String(entry?.audioPath || "");
  state.failures = state.failures.filter((item) => String(item?.audioPath || "") !== audioPath);
  state.failures.push({ ...entry, audioPath, at: Number(entry?.at) || Date.now() });
  state.failures = state.failures.slice(-MAX_LOG_ENTRIES);
  state.updatedAt = Date.now();
  fs.mkdirSync(workDir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}
