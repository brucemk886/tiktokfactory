import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKieImageTaskInput,
  filterKieImageModels,
  kieImageModelLabel,
  kieRemoteImageModel,
  normalizeKieImageModel,
  Z_IMAGE_PROMPT_LIMIT
} from "./kie-image-models.js";

test("normalizes known Kie image models and drops unknown ones", () => {
  assert.equal(normalizeKieImageModel("z-image"), "z-image");
  assert.equal(normalizeKieImageModel("unknown"), "nano-banana");
  assert.deepEqual(filterKieImageModels(["z-image", "grok", "flux"]), ["z-image", "grok"]);
  assert.equal(kieRemoteImageModel("z-image"), "z-image");
  assert.equal(kieImageModelLabel("z-image"), "Z-Image");
});

test("builds a z-image task within the 1000-character prompt limit", () => {
  const longPrompt = "A".repeat(1200);
  const created = buildKieImageTaskInput({
    imageModel: "z-image",
    prompt: longPrompt,
    aspectRatio: "9:16"
  });
  assert.equal(created.model, "z-image");
  assert.equal(created.input.aspect_ratio, "9:16");
  assert.equal(created.input.output_format, undefined);
  assert.ok(created.input.prompt.length <= Z_IMAGE_PROMPT_LIMIT);
  assert.match(created.input.prompt, /Visuals only/);
  assert.doesNotMatch(created.input.prompt, /Marais|balustrade|official Z-Image/);
});

test("does not inject official Z-Image reference examples into the generation prompt", () => {
  const created = buildKieImageTaskInput({
    imageModel: "z-image",
    prompt: "Four real coffee cups on a marble cafe table",
    aspectRatio: "9:16"
  });
  assert.match(created.input.prompt, /Four real coffee cups on a marble cafe table/);
  assert.doesNotMatch(created.input.prompt, /Marais district of Paris/);
  assert.doesNotMatch(created.input.prompt, /white balustrade/);
  assert.doesNotMatch(created.input.prompt, /official Z-Image examples/);
});
