import assert from "node:assert/strict";
import test from "node:test";
import { isOfficialPublishAbort, officialPublishAbortError, throwIfOfficialPublishAborted } from "./official-publish-abort.js";

test("abort helper marks a stop as aborted", () => {
  const error = officialPublishAbortError();
  assert.equal(error.aborted, true);
  assert.equal(isOfficialPublishAbort(error), true);
  assert.equal(isOfficialPublishAbort(new Error("上传失败")), false);
});

test("throwIfOfficialPublishAborted only throws when stop is requested", async () => {
  await throwIfOfficialPublishAborted(async () => false);
  await assert.rejects(() => throwIfOfficialPublishAborted(async () => true), (error) => isOfficialPublishAbort(error));
});
