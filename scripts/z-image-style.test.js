import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  selectedModelsUseZImage,
  Z_IMAGE_OFFICIAL_PROMPTS,
  Z_IMAGE_WRITER_REFERENCE,
  zImageWriterInstructions
} from "./z-image-style.js";

test("records the two official Z-Image prompts", () => {
  assert.equal(Z_IMAGE_OFFICIAL_PROMPTS.length, 2);
  assert.match(Z_IMAGE_OFFICIAL_PROMPTS[0].prompt, /Marais district of Paris/);
  assert.match(Z_IMAGE_OFFICIAL_PROMPTS[0].prompt, /iPhone image/);
  assert.match(Z_IMAGE_OFFICIAL_PROMPTS[1].prompt, /flash photography/);
  assert.match(Z_IMAGE_OFFICIAL_PROMPTS[1].prompt, /white balustrade/);
  assert.equal(Z_IMAGE_WRITER_REFERENCE.id, "marais-morning");
  assert.equal(selectedModelsUseZImage(["nano-banana", "z-image"]), true);
  assert.equal(selectedModelsUseZImage(["grok"]), false);
});

test("writer instructions send only the short daylight reference", () => {
  const writer = zImageWriterInstructions({ purpose: "quiz-grid" });
  assert.match(writer, /REFERENCE ONLY/);
  assert.match(writer, /Do not paste it into the image-generation prompt/);
  assert.match(writer, /Marais district of Paris/);
  assert.match(writer, /pixie cut/);
  assert.match(writer, /choice layout/);
  assert.doesNotMatch(writer, /white balustrade|date night/);
});

test("frontend psychology writer keeps the same official Z-Image references", () => {
  const psychologyJs = fs.readFileSync(new URL("../public/psychology.js", import.meta.url), "utf8");
  assert.match(psychologyJs, /REFERENCE ONLY/);
  assert.match(psychologyJs, /Marais district of Paris/);
  assert.match(psychologyJs, /iPhone image/);
  assert.doesNotMatch(psychologyJs, /white balustrade|date night/);
});
