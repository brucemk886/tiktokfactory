import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  attachScriptTranscripts,
  persistScriptTranscripts,
  slimNovelScripts,
  stripScriptWords
} from "./script-transcripts.js";

function memoryTranscriptDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (/INSERT INTO factory_script_transcripts/.test(sql)) {
                rows.set(args[0], {
                  script_id: args[0],
                  novel_id: args[1],
                  text: args[2],
                  words_json: args[3],
                  provider: args[4],
                  model: args[5],
                  updated_at: args[6]
                });
              }
              return { meta: { changes: 1 } };
            },
            async all() {
              return {
                results: [...rows.values()].filter((row) => args.includes(row.script_id))
              };
            }
          };
        }
      };
    }
  };
}

test("slim novel scripts drop word arrays before the catalog blob is saved", () => {
  const scripts = slimNovelScripts([
    { id: "s1", text: "hello", words: [{ text: "hello", start: 0, end: 1 }] },
    { id: "s2", text: "plain" }
  ]);
  assert.equal(scripts[0].text, "hello");
  assert.equal(scripts[0].words, undefined);
  assert.equal(scripts[1].words, undefined);
  assert.equal(stripScriptWords({ id: "s1", words: [] }).words, undefined);
});

test("persist and attach keep words in the sidecar table", async () => {
  const db = memoryTranscriptDb();
  const scripts = [
    { id: "s1", novelId: "n1", text: "hello there", words: [{ text: "hello" }, { text: "there" }], transcriptProvider: "elevenlabs", transcriptModel: "scribe_v2" },
    { id: "s2", novelId: "n1", text: "no words yet" }
  ];
  assert.equal(await persistScriptTranscripts(db, scripts), 1);
  const attached = await attachScriptTranscripts(db, slimNovelScripts(scripts));
  assert.equal(attached[0].text, "hello there");
  assert.deepEqual(attached[0].words.map((item) => item.text), ["hello", "there"]);
  assert.equal(attached[0].transcriptModel, "scribe_v2");
  assert.equal(attached[1].words, undefined);
});

test("factory no longer wakes every minute to drain transcripts", async () => {
  const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.doesNotMatch(wrangler, /"\* \* \* \* \*"/);
});
