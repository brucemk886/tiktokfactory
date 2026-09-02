import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SIDEBAR_MODULES } from "./sidebar-modules.js";

const root = process.cwd();

test("quiz module is wired through page, local server, cloud queue, and local worker", () => {
  const page = fs.readFileSync(path.join(root, "public", "quiz.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "scripts", "server.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "scripts", "factory-cloud-worker.js"), "utf8");
  const cloudJobs = fs.readFileSync(path.join(root, "factory-cloud", "src", "jobs.js"), "utf8");
  const cloudPages = fs.readFileSync(path.join(root, "factory-cloud", "src", "pages.js"), "utf8");
  assert.match(page, /<script src="\/quiz\.js"><\/script>/);
  assert.match(page, /href="\/quiz\.css"/);
  assert.match(server, /url\.pathname === "\/api\/quiz\/start"/);
  assert.match(server, /url\.pathname\.startsWith\("\/api\/quiz\/progress\/"\)/);
  assert.match(worker, /quiz: "quiz-render-job\.js"/);
  assert.match(cloudJobs, /\^\\\/api\\\/quiz\\\/start\$/);
  assert.match(cloudPages, /"\/quiz": "quiz\.html"/);
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "quiz")?.href, "/quiz");
});
