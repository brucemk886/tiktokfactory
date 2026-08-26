import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runAudioImportJob } from "./audio-import-job.js";

test("import job downloads cloud audio and copies it into the novel folder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-import-job-"));
  const workDir = path.join(root, "work");
  fs.mkdirSync(workDir, { recursive: true });
  const bytes = Buffer.alloc(2048, 9);
  const result = await runAudioImportJob({
    root,
    workDir,
    config: { audioLibraryRoot: path.join(root, "library") },
    payload: {
      novelTitle: "Imported Book",
      targetAudioDir: "__novel__",
      items: [{
        novelId: "n1",
        scriptId: "s1",
        audioId: "upload-job-1",
        title: "Imported Hook",
        fileName: "hook.mp3"
      }]
    },
    cloudUrl: "https://factory.example",
    workerToken: "token",
    fetchImpl: async (url) => {
      assert.match(String(url), /\/api\/worker\/audio\/upload-job-1$/);
      return {
        ok: true,
        arrayBuffer: async () => bytes
      };
    }
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].audioId, "upload-job-1");
  assert.ok(fs.existsSync(result.items[0].targetAudioPath));
  fs.rmSync(root, { recursive: true, force: true });
});
