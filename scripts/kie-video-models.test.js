import assert from "node:assert/strict";
import test from "node:test";
import { buildKieVideoTaskInput } from "./kie-video-models.js";

test("MiniMax uses the documented task model, numeric duration and no Grok mode", () => {
  assert.deepEqual(buildKieVideoTaskInput({ videoModel: "minimax-h3", prompt: "A quiet lake", duration: "4", aspectRatio: "21:9", resolution: "2K" }), {
    model: "minimax-h3/text-to-video",
    input: { prompt: "A quiet lake", duration: 4, aspect_ratio: "21:9", resolution: "2K" }
  });
  assert.deepEqual(buildKieVideoTaskInput({ videoModel: "minimax-h3", prompt: "A quiet lake" }).input, {
    prompt: "A quiet lake", duration: 6, aspect_ratio: "9:16", resolution: "768P"
  });
  assert.equal(buildKieVideoTaskInput({ videoModel: "minimax-h3", prompt: "x".repeat(7000), duration: 15 }).input.duration, 15);
});

test("invalid MiniMax parameters fail before any provider request", () => {
  for (const overrides of [
    { videoModel: "unknown" }, { videoModel: "constructor" },
    { duration: 3 }, { duration: 16 }, { duration: "abc" }, { duration: 4.5 },
    { duration: "" }, { duration: 0 }, { resolution: "720p" },
    { aspectRatio: "3:2" }, { prompt: "x".repeat(7001) }
  ]) {
    assert.throws(() => buildKieVideoTaskInput({ videoModel: "minimax-h3", prompt: "A quiet lake", ...overrides }), { statusCode: 400 });
  }
});

test("omitting a model keeps legacy Grok defaults", () => {
  assert.deepEqual(buildKieVideoTaskInput({ prompt: "A quiet lake" }), {
    model: "grok-imagine/text-to-video",
    input: { prompt: "A quiet lake", aspect_ratio: "9:16", mode: "normal", duration: "6", resolution: "480p" }
  });
});
