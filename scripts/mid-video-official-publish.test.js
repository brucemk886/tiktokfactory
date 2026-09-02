import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("all shipped mid-video publishing surfaces use the official TikTok channel", () => {
  const schultePage = read("public", "schulte.html");
  const schulteClient = read("public", "schulte.js");
  const quizPage = read("public", "quiz.html");
  const quizClient = read("public", "quiz.js");
  const podcastPage = read("public", "index.html");
  const podcastClient = read("public", "app.js");

  for (const source of [schultePage, schulteClient, quizPage, quizClient, podcastPage, podcastClient]) {
    assert.doesNotMatch(source, /\/api\/geelark\/(?:phones|publish)/);
  }
  assert.match(schultePage, /TikTok 官方发布/);
  assert.match(schulteClient, /provider: "official"/);
  assert.match(schulteClient, /connectionIds/);
  assert.match(quizPage, /id="quizAutoPublish"/);
  assert.match(quizClient, /provider: "official"/);
  assert.match(podcastPage, /TikTok 官方发布/);
  assert.match(podcastClient, /fetch\("\/api\/official-tiktok\/publish"/);
  assert.match(podcastClient, /module: "mid-video"/);
});

test("cloud queue validates automatic official publishing and scopes recent videos", () => {
  const jobs = read("factory-cloud", "src", "jobs.js");
  const compat = read("factory-cloud", "src", "compat.js");
  const publishPage = read("public", "module-publish.js");

  assert.match(jobs, /automaticOfficialPublish/);
  assert.match(jobs, /assertOfficialPublishAccess/);
  assert.match(compat, /taskType === "schulte"/);
  assert.match(compat, /publish\.provider = "official"/);
  assert.match(compat, /assertOfficialPublishAccess/);
  assert.match(publishPage, /recent-videos\?module=/);
});
