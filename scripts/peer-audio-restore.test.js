import assert from "node:assert/strict";
import test from "node:test";
import { shouldRestorePeerSourceAudio } from "./peer-audio-restore.js";

test("restores a ~10s placeholder that overwrote a multi-minute peer clip", () => {
  assert.equal(shouldRestorePeerSourceAudio({
    destSize: 105_000,
    sourceSize: 7_900_000,
    destDuration: 10
  }), true);
});

test("leaves a real short peer clip alone when both sides are small", () => {
  assert.equal(shouldRestorePeerSourceAudio({
    destSize: 98_000,
    sourceSize: 110_000,
    destDuration: 10
  }), false);
});

test("leaves a full-length clip alone when sizes are close", () => {
  assert.equal(shouldRestorePeerSourceAudio({
    destSize: 7_800_000,
    sourceSize: 7_900_000,
    destDuration: 330
  }), false);
});

test("restores when dest size is missing but the peer original is large", () => {
  assert.equal(shouldRestorePeerSourceAudio({
    destSize: 0,
    sourceSize: 5_200_000,
    destDuration: 0
  }), true);
});
