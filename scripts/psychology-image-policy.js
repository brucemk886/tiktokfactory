export const PSYCHOLOGY_IMAGE_MODEL = "z-image";
const TYPES = new Set(["psychology", "psychology-collage", "psychology-target-2", "psychology-narrative"]);

// Apply at queue creation and delivery so saved browser settings and older
// queued jobs cannot select a different image provider for psychology.
export function psychologyImagePayload(type, payload = {}) {
  if (!TYPES.has(type)) return payload;
  const next = { ...payload, imageModel: PSYCHOLOGY_IMAGE_MODEL, imageModels: [PSYCHOLOGY_IMAGE_MODEL] };
  if (payload?.generation && typeof payload.generation === "object" && !Array.isArray(payload.generation)) {
    next.generation = { ...payload.generation, imageModel: PSYCHOLOGY_IMAGE_MODEL, imageModels: [PSYCHOLOGY_IMAGE_MODEL] };
  }
  return next;
}
