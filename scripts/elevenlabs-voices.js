export const NOVEL_TTS_MODEL_ID = "eleven_multilingual_v2";
export const NOVEL_TTS_MODEL_NAME = "Eleven Multilingual v2";

export async function listElevenLabsVoices({
  apiKey = "",
  defaultVoiceId = "",
  fetchImpl = globalThis.fetch
} = {}) {
  const key = String(apiKey || "").trim();
  const selected = String(defaultVoiceId || "").trim();
  if (!key) {
    const error = new Error("ElevenLabs API Key 未配置。");
    error.statusCode = 400;
    throw error;
  }
  const headers = { "xi-api-key": key, Accept: "application/json" };
  let response = await fetchImpl("https://api.elevenlabs.io/v1/voices", { headers });
  let body = await readJsonSafe(response);
  if (!response.ok || !Array.isArray(body.voices) || !body.voices.length) {
    const fallback = await fetchImpl("https://api.elevenlabs.io/v2/voices?page_size=100", { headers });
    const fallbackBody = await readJsonSafe(fallback);
    if (fallback.ok && Array.isArray(fallbackBody.voices) && fallbackBody.voices.length) {
      response = fallback;
      body = fallbackBody;
    }
  }
  if (!response.ok) {
    const detail = voiceErrorDetail(body);
    if (Number(response.status) === 401 && /voices_read/i.test(detail)) {
      const voices = fallbackVoices(selected);
      return {
        voices,
        defaultVoiceId: selected,
        modelId: NOVEL_TTS_MODEL_ID,
        modelName: NOVEL_TTS_MODEL_NAME,
        filters: buildVoiceFilters(voices),
        restricted: true,
        warning: "当前 ElevenLabs Key 没有声音列表权限（voices_read）。已带入最近用过的声音和常用声音，也可手动填写 Voice ID。"
      };
    }
    const error = new Error(`读取 ElevenLabs 声音失败：${detail || response.status}`);
    error.statusCode = response.status || 502;
    throw error;
  }
  const voices = (Array.isArray(body.voices) ? body.voices : []).map(mapVoice).filter((voice) => voice.id);
  if (!voices.length) {
    const fallback = fallbackVoices(selected);
    return {
      voices: fallback,
      defaultVoiceId: selected,
      modelId: NOVEL_TTS_MODEL_ID,
      modelName: NOVEL_TTS_MODEL_NAME,
      filters: buildVoiceFilters(fallback),
      restricted: true,
      warning: "ElevenLabs 没有返回声音列表。已带入最近用过的声音和常用声音，也可手动填写 Voice ID。"
    };
  }
  return {
    voices,
    defaultVoiceId: selected,
    modelId: NOVEL_TTS_MODEL_ID,
    modelName: NOVEL_TTS_MODEL_NAME,
    filters: buildVoiceFilters(voices)
  };
}

export function mapVoice(voice = {}) {
  const labels = voice.labels && typeof voice.labels === "object" ? voice.labels : {};
  const languages = uniqueStrings([
    ...languageCodes(voice.verified_languages),
    labels.language,
    labels.accent
  ].map(normalizeLanguage)).filter(Boolean);
  const category = normalizeCategory(voice.category);
  const gender = normalizeGender(labels.gender);
  const age = normalizeAge(labels.age);
  return {
    id: String(voice.voice_id || voice.id || "").trim(),
    name: String(voice.name || voice.voice_id || "未命名声音").trim(),
    category,
    categoryLabel: CATEGORY_LABELS[category] || category,
    gender,
    genderLabel: GENDER_LABELS[gender] || gender,
    age,
    ageLabel: AGE_LABELS[age] || age,
    languages,
    languageLabels: languages.map((code) => LANGUAGE_LABELS[code] || code),
    previewUrl: String(voice.preview_url || voice.previewUrl || "").trim()
  };
}

export function buildVoiceFilters(voices = []) {
  return {
    languages: uniqueOptions(voices.flatMap((voice) => (voice.languages || []).map((value, index) => ({
      value,
      label: voice.languageLabels?.[index] || LANGUAGE_LABELS[value] || value
    })))),
    categories: uniqueOptions(voices.filter((voice) => voice.category).map((voice) => ({
      value: voice.category,
      label: voice.categoryLabel || CATEGORY_LABELS[voice.category] || voice.category
    }))),
    genders: uniqueOptions(voices.filter((voice) => voice.gender).map((voice) => ({
      value: voice.gender,
      label: voice.genderLabel || GENDER_LABELS[voice.gender] || voice.gender
    }))),
    ages: uniqueOptions(voices.filter((voice) => voice.age).map((voice) => ({
      value: voice.age,
      label: voice.ageLabel || AGE_LABELS[voice.age] || voice.age
    })))
  };
}

export function fallbackVoices(defaultVoiceId) {
  const saved = String(defaultVoiceId || "").trim();
  const items = saved ? [mapVoice({ voice_id: saved, name: "最近使用的声音", category: "saved" })] : [];
  for (const voice of [
    { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade", labels: { gender: "female", age: "young", language: "en" } },
    { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", category: "premade", labels: { gender: "female", age: "young", language: "en" } },
    { voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam", category: "premade", labels: { gender: "male", age: "middle_aged", language: "en" } },
    { voice_id: "JBFqnCBsd6RMkjVDRZzb", name: "George", category: "premade", labels: { gender: "male", age: "middle_aged", language: "en" } },
    { voice_id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", category: "premade", labels: { gender: "male", age: "middle_aged", language: "en" } }
  ]) {
    const mapped = mapVoice(voice);
    if (!items.some((item) => item.id === mapped.id)) items.push(mapped);
  }
  return items;
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function voiceErrorDetail(body) {
  if (!body || typeof body !== "object") return "";
  if (typeof body.detail === "string") return body.detail;
  if (typeof body.message === "string") return body.message;
  if (body.detail && typeof body.detail === "object") {
    return String(body.detail.message || body.detail.status || JSON.stringify(body.detail)).slice(0, 400);
  }
  return "";
}

function languageCodes(verified = []) {
  return (Array.isArray(verified) ? verified : []).flatMap((item) => [
    item?.language,
    String(item?.locale || "").split("-")[0]
  ]);
}

function normalizeLanguage(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (LANGUAGE_ALIASES[text]) return LANGUAGE_ALIASES[text];
  if (LANGUAGE_LABELS[text]) return text;
  return text.slice(0, 24);
}

function normalizeCategory(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "premade" || text === "cloned" || text === "generated" || text === "professional" || text === "saved") return text;
  return text;
}

function normalizeGender(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "male" || text === "female" || text === "neutral") return text;
  return "";
}

function normalizeAge(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (text === "young" || text === "old") return text;
  if (text === "middle_aged" || text === "middle" || text === "middleaged") return "middle_aged";
  return "";
}

function uniqueOptions(items) {
  const seen = new Set();
  return items.filter((item) => {
    const value = String(item?.value || "").trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  }).sort((left, right) => String(left.label).localeCompare(String(right.label), "zh-Hans-CN"));
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

const LANGUAGE_LABELS = {
  en: "English", zh: "Chinese", ja: "Japanese", ko: "Korean", es: "Spanish", fr: "French",
  de: "German", pt: "Portuguese", it: "Italian", hi: "Hindi", ar: "Arabic", id: "Indonesian",
  nl: "Dutch", pl: "Polish", ru: "Russian", tr: "Turkish", vi: "Vietnamese", th: "Thai"
};

const LANGUAGE_ALIASES = {
  english: "en", chinese: "zh", japanese: "ja", korean: "ko", spanish: "es", french: "fr",
  german: "de", portuguese: "pt", italian: "it", hindi: "hi", arabic: "ar", american: "en",
  british: "en", australian: "en", "en-us": "en", "en-gb": "en", "zh-cn": "zh"
};

const CATEGORY_LABELS = {
  premade: "官方音色",
  cloned: "克隆音色",
  generated: "生成音色",
  professional: "专业音色",
  saved: "最近使用"
};

const GENDER_LABELS = { male: "男性", female: "女性", neutral: "中性" };
const AGE_LABELS = { young: "青年", middle_aged: "中年", old: "老年" };
