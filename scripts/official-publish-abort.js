export function officialPublishAbortError(message = "任务已停止。") {
  const error = new Error(message);
  error.aborted = true;
  return error;
}

export function isOfficialPublishAbort(error) {
  return Boolean(error?.aborted) || String(error?.message || "") === "任务已停止。";
}

export async function throwIfOfficialPublishAborted(shouldAbort) {
  if (typeof shouldAbort !== "function") return;
  if (await shouldAbort()) throw officialPublishAbortError();
}
