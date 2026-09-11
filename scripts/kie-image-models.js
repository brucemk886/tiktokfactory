export const KIE_IMAGE_MODELS = {
  grok: "grok-imagine/text-to-image",
  "nano-banana": "google/nano-banana",
  "z-image": "z-image"
};

export const DEFAULT_KIE_IMAGE_MODEL = "nano-banana";
export const Z_IMAGE_PROMPT_LIMIT = 1000;

const LONG_NO_TEXT_RULE = "\n\nMANDATORY OUTPUT RULE: Create visuals only. Do not render any visible text, captions, titles, labels, letters, numbers, logos, watermarks, subtitles, signs, interface elements, or typography anywhere in the image. If the concept mentions words or labels, express them only through imagery. Leave clean visual space so text can be added later in post-production.";
const SHORT_NO_TEXT_RULE = "\n\nVisuals only. No text, letters, numbers, logos, captions, or typography.";

export function isKieImageModel(value) {
  return Object.prototype.hasOwnProperty.call(KIE_IMAGE_MODELS, String(value || "").trim());
}

export function normalizeKieImageModel(value, fallback = DEFAULT_KIE_IMAGE_MODEL) {
  const id = String(value || "").trim();
  return isKieImageModel(id) ? id : fallback;
}

export function filterKieImageModels(values, fallback = DEFAULT_KIE_IMAGE_MODEL) {
  const ids = (Array.isArray(values) ? values : [])
    .map((item) => String(item || "").trim())
    .filter((id) => isKieImageModel(id));
  return ids.length ? [...new Set(ids)] : [fallback];
}

export function kieRemoteImageModel(value) {
  return KIE_IMAGE_MODELS[normalizeKieImageModel(value)];
}

export function kieImageModelLabel(value) {
  const id = String(value || "").trim();
  if (id === "grok" || id === "grok-imagine/text-to-image") return "Grok Imagine";
  if (id === "z-image") return "Z-Image";
  return "Nano Banana";
}

export function buildKieImageTaskInput({ imageModel, prompt, aspectRatio, noImageText = true } = {}) {
  const localId = normalizeKieImageModel(imageModel);
  const model = KIE_IMAGE_MODELS[localId];
  const ratio = String(aspectRatio || "9:16");
  const text = composeImagePrompt(String(prompt || ""), { imageModel: localId, noImageText });
  if (model === "google/nano-banana") {
    return { model, input: { prompt: text, aspect_ratio: ratio, output_format: "png" } };
  }
  return { model, input: { prompt: text, aspect_ratio: ratio } };
}

function composeImagePrompt(prompt, { imageModel, noImageText }) {
  const source = String(prompt || "");
  if (noImageText === false) {
    return imageModel === "z-image" ? clipPrompt(source, Z_IMAGE_PROMPT_LIMIT) : source;
  }
  if (imageModel !== "z-image") return `${source}${LONG_NO_TEXT_RULE}`;
  const budget = Math.max(0, Z_IMAGE_PROMPT_LIMIT - SHORT_NO_TEXT_RULE.length);
  return `${clipPrompt(source, budget)}${SHORT_NO_TEXT_RULE}`;
}

function clipPrompt(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : text.slice(0, limit).trimEnd();
}
