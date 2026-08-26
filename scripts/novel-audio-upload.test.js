import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveLocalAudioUploadPath } from "./novel-audio-upload.js";

test("prefers the library file then the copied novel-folder file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-upload-"));
  const libraryFile = path.join(root, "library.mp3");
  const copied = path.join(root, "book.mp3");
  fs.writeFileSync(libraryFile, "lib");
  fs.writeFileSync(copied, "copy");
  assert.equal(resolveLocalAudioUploadPath({
    resolveAudioPath: (id) => id === "audio-1" ? libraryFile : ""
  }, { audioId: "audio-1", targetAudioPath: copied }), libraryFile);
  assert.equal(resolveLocalAudioUploadPath({
    resolveAudioPath: () => ""
  }, { audioId: "audio-1", targetAudioPath: copied }), copied);
  assert.equal(resolveLocalAudioUploadPath({
    resolveAudioPath: () => path.join(root, "missing.mp3")
  }, { audioId: "audio-1", targetAudioPath: root }), "");
  fs.rmSync(root, { recursive: true, force: true });
});
