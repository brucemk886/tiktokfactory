export const DEFAULT_KOKORO_MALE_VOICE = "am_adam";
export const DEFAULT_KOKORO_FEMALE_VOICE = "af_jessica";
export const DEFAULT_KOKORO_VOICE = DEFAULT_KOKORO_MALE_VOICE;
export const DEFAULT_KOKORO_CHINESE_VOICE = "zf_xiaoxiao";

export const KOKORO_VOICES = Object.freeze([
  { id: "am_adam", name: "Adam", gender: "male", age: "young", language: "en-us" },
  { id: "am_michael", name: "Michael", gender: "male", age: "middle", language: "en-us" },
  { id: "am_echo", name: "Echo", gender: "male", age: "middle", language: "en-us" },
  { id: "am_eric", name: "Eric", gender: "male", age: "middle", language: "en-us" },
  { id: "am_fenrir", name: "Fenrir", gender: "male", age: "middle", language: "en-us" },
  { id: "am_liam", name: "Liam", gender: "male", age: "young", language: "en-us" },
  { id: "am_onyx", name: "Onyx", gender: "male", age: "middle", language: "en-us" },
  { id: "am_puck", name: "Puck", gender: "male", age: "young", language: "en-us" },
  { id: "am_santa", name: "Santa", gender: "male", age: "middle", language: "en-us" },
  { id: "af_jessica", name: "Jessica", gender: "female", age: "young", language: "en-us" },
  { id: "af_heart", name: "Heart", gender: "female", age: "young", language: "en-us" },
  { id: "af_alloy", name: "Alloy", gender: "female", age: "young", language: "en-us" },
  { id: "af_aoede", name: "Aoede", gender: "female", age: "young", language: "en-us" },
  { id: "af_bella", name: "Bella", gender: "female", age: "young", language: "en-us" },
  { id: "af_kore", name: "Kore", gender: "female", age: "young", language: "en-us" },
  { id: "af_nicole", name: "Nicole", gender: "female", age: "young", language: "en-us" },
  { id: "af_nova", name: "Nova", gender: "female", age: "young", language: "en-us" },
  { id: "af_river", name: "River", gender: "female", age: "young", language: "en-us" },
  { id: "af_sarah", name: "Sarah", gender: "female", age: "young", language: "en-us" },
  { id: "af_sky", name: "Sky", gender: "female", age: "young", language: "en-us" },
  { id: "bf_alice", name: "Alice", gender: "female", age: "young", language: "en-gb" },
  { id: "bf_emma", name: "Emma", gender: "female", age: "young", language: "en-gb" },
  { id: "bf_isabella", name: "Isabella", gender: "female", age: "young", language: "en-gb" },
  { id: "bf_lily", name: "Lily", gender: "female", age: "young", language: "en-gb" },
  { id: "bm_daniel", name: "Daniel", gender: "male", age: "middle", language: "en-gb" },
  { id: "bm_fable", name: "Fable", gender: "male", age: "young", language: "en-gb" },
  { id: "bm_george", name: "George", gender: "male", age: "middle", language: "en-gb" },
  { id: "bm_lewis", name: "Lewis", gender: "male", age: "young", language: "en-gb" },
  { id: "zf_xiaoxiao", name: "Xiaoxiao", gender: "female", age: "young", language: "zh-cn" },
  { id: "zf_xiaoni", name: "Xiaoni", gender: "female", age: "young", language: "zh-cn" },
  { id: "zf_xiaobei", name: "Xiaobei", gender: "female", age: "young", language: "zh-cn" },
  { id: "zf_xiaoyi", name: "Xiaoyi", gender: "female", age: "young", language: "zh-cn" },
  { id: "zm_yunxi", name: "Yunxi", gender: "male", age: "young", language: "zh-cn" },
  { id: "zm_yunyang", name: "Yunyang", gender: "male", age: "middle", language: "zh-cn" },
  { id: "zm_yunjian", name: "Yunjian", gender: "male", age: "middle", language: "zh-cn" },
  { id: "zm_yunxia", name: "Yunxia", gender: "male", age: "young", language: "zh-cn" }
]);

export function kokoroLangCode(voiceId) {
  const prefix = String(voiceId || "").trim().slice(0, 1).toLowerCase();
  if (prefix === "b") return "b";
  if (prefix === "z") return "z";
  if (prefix === "j") return "j";
  return "a";
}

export function normalizeTtsProvider(value) {
  return String(value || "").trim() === "elevenlabs" ? "elevenlabs" : "kokoro";
}

export function isKokoroVoiceId(value) {
  const id = String(value || "").trim();
  return KOKORO_VOICES.some((voice) => voice.id === id);
}

export function normalizeNarratorGender(value) {
  return String(value || "").trim() === "female" ? "female" : "male";
}

export function defaultKokoroVoice(gender = "") {
  return normalizeNarratorGender(gender) === "female" ? DEFAULT_KOKORO_FEMALE_VOICE : DEFAULT_KOKORO_MALE_VOICE;
}

export function kokoroVoiceGender(voiceId) {
  const id = String(voiceId || "").trim();
  return KOKORO_VOICES.find((voice) => voice.id === id)?.gender || "";
}

export function resolveKokoroVoice(value, { gender } = {}) {
  return isKokoroVoiceId(value) ? String(value).trim() : defaultKokoroVoice(gender);
}

export function resolveVoiceForProvider(provider, voiceId) {
  if (normalizeTtsProvider(provider) === "elevenlabs") return String(voiceId || "").trim();
  return resolveKokoroVoice(voiceId);
}

export function resolveVoiceForNarrator(provider, voiceId, gender) {
  const narratorGender = normalizeNarratorGender(gender);
  if (normalizeTtsProvider(provider) === "elevenlabs") return String(voiceId || "").trim();
  const id = String(voiceId || "").trim();
  if (id && kokoroVoiceGender(id) === narratorGender) return id;
  return defaultKokoroVoice(narratorGender);
}

export function kokoroPreviewUrl(voiceId) {
  return `/kokoro-previews/${resolveKokoroVoice(voiceId)}.mp3`;
}

export function listKokoroVoices({ defaultVoiceId = "" } = {}) {
  const selected = resolveKokoroVoice(defaultVoiceId);
  const voices = KOKORO_VOICES.map(mapKokoroVoice);
  return {
    provider: "kokoro",
    voices,
    defaultVoiceId: selected,
    defaultMaleVoiceId: DEFAULT_KOKORO_MALE_VOICE,
    defaultFemaleVoiceId: DEFAULT_KOKORO_FEMALE_VOICE,
    modelId: "kokoro-82m",
    modelName: "Kokoro 82M 本地配音",
    filters: {
      languages: uniqueOptions(voices.flatMap((voice) => (voice.languages || []).map((value, index) => ({
        value,
        label: voice.languageLabels?.[index] || value
      })))),
      categories: [{ value: "kokoro", label: "本机 Kokoro" }],
      genders: [
        { value: "female", label: "女性" },
        { value: "male", label: "男性" }
      ],
      ages: uniqueOptions(voices.map((voice) => ({ value: voice.age, label: voice.ageLabel })))
    }
  };
}

function mapKokoroVoice(voice) {
  const chinese = voice.language === "zh-cn";
  const british = voice.language === "en-gb";
  const age = voice.age === "middle" ? "middle_aged" : voice.age;
  return {
    id: voice.id,
    name: voice.id === DEFAULT_KOKORO_FEMALE_VOICE
      ? `${voice.name}（默认女声）`
      : voice.id === DEFAULT_KOKORO_VOICE
        ? `${voice.name}（默认男声）`
        : voice.id === DEFAULT_KOKORO_CHINESE_VOICE
          ? `${voice.name}（中文女声）`
          : voice.name,
    category: "kokoro",
    categoryLabel: "本机 Kokoro",
    gender: voice.gender,
    genderLabel: voice.gender === "female" ? "女性" : "男性",
    age,
    ageLabel: age === "middle_aged" ? "中年" : "青年",
    languages: chinese ? ["zh"] : ["en"],
    languageLabels: [chinese ? "中文" : british ? "English (UK)" : "English"],
    previewUrl: `/kokoro-previews/${voice.id}.mp3`
  };
}

function uniqueOptions(items) {
  const seen = new Set();
  return items.filter((item) => {
    const value = String(item?.value || "").trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
