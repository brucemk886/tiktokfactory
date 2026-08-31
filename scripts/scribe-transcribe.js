export const SCRIBE_STT_MODEL_ID = "scribe_v2";

export function normalizeScribeWords(words = []) {
  return (Array.isArray(words) ? words : [])
    .map((item) => ({
      text: String(item?.text || item?.word || "").replace(/[{}]/g, "").trim(),
      start: Number(item?.start ?? item?.start_ts ?? item?.start_time),
      end: Number(item?.end ?? item?.end_ts ?? item?.end_time)
    }))
    .filter((item) => item.text && /[\p{L}\p{N}]/u.test(item.text) && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start)
    .sort((left, right) => left.start - right.start);
}

export async function transcribeAudioBuffer({
  apiKey,
  audioBuffer,
  fileName = "speech.mp3",
  contentType = "audio/mpeg",
  modelId = SCRIBE_STT_MODEL_ID,
  fetchImpl = fetch
} = {}) {
  if (!String(apiKey || "").trim()) {
    throw Object.assign(new Error("ElevenLabs API Key 未配置，无法识别口播。"), { statusCode: 400 });
  }
  const bytes = toUint8Array(audioBuffer);
  if (bytes.byteLength < 1024) {
    throw Object.assign(new Error("音频太小，无法识别口播。"), { statusCode: 400 });
  }
  const form = new FormData();
  form.append("model_id", modelId || SCRIBE_STT_MODEL_ID);
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  form.append("file", new Blob([bytes], { type: contentType || "audio/mpeg" }), String(fileName || "speech.mp3"));
  const response = await fetchImpl("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": String(apiKey).trim() },
    body: form
  });
  const raw = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`口播识别失败：${raw.slice(0, 400) || response.status}`), {
      statusCode: response.status >= 400 && response.status < 600 ? response.status : 502
    });
  }
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("口播识别返回了无法解析的结果。"), { statusCode: 502 });
  }
  const words = normalizeScribeWords(data.words);
  const text = String(data.text || words.map((item) => item.text).join(" ")).trim();
  if (text.length < 8) {
    throw Object.assign(new Error("识别结果太短，没有可用口播文案。"), { statusCode: 502 });
  }
  return {
    text,
    words,
    provider: "elevenlabs",
    model: modelId || SCRIBE_STT_MODEL_ID
  };
}

function toUint8Array(audioBuffer) {
  if (audioBuffer instanceof Uint8Array) return audioBuffer;
  if (audioBuffer instanceof ArrayBuffer) return new Uint8Array(audioBuffer);
  if (ArrayBuffer.isView(audioBuffer)) return new Uint8Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength);
  return new Uint8Array(0);
}
