import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_QUIZ_QUESTIONS, normalizeQuizPayload } from "./quiz-content.js";

test("quiz defaults create a roughly one-minute seven-question video", () => {
  const result = normalizeQuizPayload({});
  assert.equal(result.language, "en");
  assert.equal(result.questions.length, 7);
  assert.equal(result.durationSeconds, 61);
  assert.equal(result.questions[0].answerIndex, 1);
});

test("quiz accepts Chinese copy and letter answers", () => {
  const questions = DEFAULT_QUIZ_QUESTIONS.zh.map((item, index) => ({
    ...item,
    answerIndex: undefined,
    answer: ["A", "B", "C"][index % 3]
  }));
  const result = normalizeQuizPayload({ language: "zh", questions, secondsPerQuestion: 20 });
  assert.equal(result.language, "zh");
  assert.equal(result.secondsPerQuestion, 12);
  assert.deepEqual(result.questions.slice(0, 3).map((item) => item.answerIndex), [0, 1, 2]);
});

test("quiz rejects incomplete question sets", () => {
  assert.throws(
    () => normalizeQuizPayload({ questions: [{ prompt: "Only one", options: ["A", "B", "C"], answerIndex: 0 }] }),
    /6–9/
  );
  const broken = DEFAULT_QUIZ_QUESTIONS.en.map((item) => ({ ...item }));
  broken[2] = { prompt: "Broken", options: ["A", "B"], answerIndex: 0 };
  assert.throws(() => normalizeQuizPayload({ questions: broken }), /必须填写 3 个选项/);
});
