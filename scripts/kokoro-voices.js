export const DEFAULT_KOKORO_VOICE = "am_michael";

export const KOKORO_VOICES = Object.freeze([
  { id: "am_michael", name: "Michael", gender: "male", age: "middle", language: "en-us" },
  { id: "am_adam", name: "Adam", gender: "male", age: "young", language: "en-us" },
  { id: "am_echo", name: "Echo", gender: "male", age: "middle", language: "en-us" },
  { id: "am_eric", name: "Eric", gender: "male", age: "middle", language: "en-us" },
  { id: "am_fenrir", name: "Fenrir", gender: "male", age: "middle", language: "en-us" },
  { id: "am_liam", name: "Liam", gender: "male", age: "young", language: "en-us" },
  { id: "am_onyx", name: "Onyx", gender: "male", age: "middle", language: "en-us" },
  { id: "am_puck", name: "Puck", gender: "male", age: "young", language: "en-us" },
  { id: "af_heart", name: "Heart", gender: "female", age: "young", language: "en-us" },
  { id: "af_bella", name: "Bella", gender: "female", age: "young", language: "en-us" },
  { id: "af_nicole", name: "Nicole", gender: "female", age: "young", language: "en-us" },
  { id: "af_sarah", name: "Sarah", gender: "female", age: "young", language: "en-us" },
  { id: "af_sky", name: "Sky", gender: "female", age: "young", language: "en-us" },
  { id: "bf_emma", name: "Emma", gender: "female", age: "young", language: "en-gb" },
  { id: "bm_george", name: "George", gender: "male", age: "middle", language: "en-gb" },
  { id: "bm_lewis", name: "Lewis", gender: "male", age: "young", language: "en-gb" }
]);

export function normalizeTtsProvider(value) {
  return String(value || "").trim() === "elevenlabs" ? "elevenlabs" : "kokoro";
}

export function isKokoroVoiceId(value) {
  const id = String(value || "").trim();
  return KOKORO_VOICES.some((voice) => voice.id === id);
}

export function resolveKokoroVoice(value) {
  return isKokoroVoiceId(value) ? String(value).trim() : DEFAULT_KOKORO_VOICE;
}

export function resolveVoiceForProvider(provider, voiceId) {
  if (normalizeTtsProvider(provider) === "elevenlabs") return String(voiceId || "").trim();
  return resolveKokoroVoice(voiceId);
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
  const british = voice.language === "en-gb";
  const age = voice.age === "middle" ? "middle_aged" : voice.age;
  return {
    id: voice.id,
    name: voice.name,
    category: "kokoro",
    categoryLabel: "本机 Kokoro",
    gender: voice.gender,
    genderLabel: voice.gender === "female" ? "女性" : "男性",
    age,
    ageLabel: age === "middle_aged" ? "中年" : "青年",
    languages: ["en"],
    languageLabels: [british ? "English (UK)" : "English"],
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
