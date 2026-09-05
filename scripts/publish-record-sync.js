import { officialPublishStoreEnabled, getPublishRecordStore } from "./publish-record-runtime.js";

export const PUBLISH_RECORD_SYNC_PROTOCOL = 2;
export const DEFAULT_SYNC_PAGE_LIMIT = 200;
export const DEFAULT_SYNC_PAGE_BYTES = 512 * 1024;
export const DEFAULT_SYNC_MAX_PAGES = 8;
export const DEFAULT_SYNC_ROUND_MS = 20_000;
export const DEFAULT_SYNC_TIMEOUT_MS = 30_000;

export function destinationKeyForFactory(url, workerId) {
  const host = String(url || "").replace(/\/+$/, "");
  return `factory:${host}:${String(workerId || "worker")}`;
}

export function isValidPublishRecordSyncAck(request, response) {
  if (!response || typeof response !== "object") return false;
  if (Number(response.protocolVersion) !== PUBLISH_RECORD_SYNC_PROTOCOL) return false;
  if (String(response.sourceStoreId || "") !== String(request.sourceStoreId || "")) return false;
  if (Number(response.ackedThroughSeq) !== Number(request.throughSeq)) return false;
  return Number.isFinite(Number(response.acceptedEventCount));
}

export function buildPublishRecordSyncRequest({
  sourceStoreId,
  workerId,
  afterSeq,
  events,
}) {
  const list = Array.isArray(events) ? events : [];
  return {
    protocolVersion: PUBLISH_RECORD_SYNC_PROTOCOL,
    sourceStoreId: String(sourceStoreId || ""),
    workerId: String(workerId || ""),
    afterSeq: Number(afterSeq) || 0,
    throughSeq: list.length ? Number(list[list.length - 1].seq) : Number(afterSeq) || 0,
    events: list.map((event) => ({
      seq: Number(event.seq),
      recordRevision: Number(event.recordRevision || event.revision) || 0,
      operation: String(event.operation || "upsert"),
      record: event.record,
    })),
  };
}

export async function syncOfficialPublishRecordsRound({
  store,
  workerId,
  destinationKey,
  requestPage,
  now = () => Date.now(),
  pageLimit = DEFAULT_SYNC_PAGE_LIMIT,
  maxBytes = DEFAULT_SYNC_PAGE_BYTES,
  maxPages = DEFAULT_SYNC_MAX_PAGES,
  maxMs = DEFAULT_SYNC_ROUND_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  retryDelays = [1_000, 2_000, 4_000],
} = {}) {
  if (!store) throw new Error("Publish record sync store is required.");
  const destination = String(destinationKey || "factory");
  const lease = store.acquireSyncLease(destination);
  if (!lease.acquired) {
    return { skipped: true, reason: "lease-held", ackedSeq: store.getSyncState(destination).ackedSeq };
  }
  const startedAt = now();
  let pages = 0;
  let accepted = 0;
  try {
    const upperSeq = store.maxOutboxSeq();
    let state = store.getSyncState(destination);
    while (pages < maxPages && now() - startedAt < maxMs) {
      if (state.ackedSeq >= upperSeq) break;
      const page = store.readOutboxPage({
        afterSeq: state.ackedSeq,
        throughSeq: upperSeq,
        limit: pageLimit,
        maxBytes,
      });
      if (page.oversized) {
        throw Object.assign(new Error(`Publish record outbox event ${page.events[0]?.seq} exceeds ${maxBytes} bytes.`), {
          code: "OUTBOX_EVENT_TOO_LARGE",
          seq: page.events[0]?.seq,
        });
      }
      if (!page.events.length) break;
      const request = buildPublishRecordSyncRequest({
        sourceStoreId: store.sourceStoreId(),
        workerId,
        afterSeq: state.ackedSeq,
        events: page.events,
      });
      const response = await sendWithRetry(requestPage, request, { retryDelays, sleep });
      if (!isValidPublishRecordSyncAck(request, response)) {
        throw Object.assign(new Error("Factory publish-records sync ACK was invalid."), {
          code: "INVALID_SYNC_ACK",
          response,
        });
      }
      state = store.ackOutboxPage(destination, request.throughSeq, request.sourceStoreId);
      accepted += Number(response.acceptedEventCount) || page.events.length;
      pages += 1;
    }
    store.pruneAckedOutbox();
    return {
      ok: true,
      pages,
      accepted,
      ackedSeq: state.ackedSeq,
      upperSeq,
      continued: state.ackedSeq < upperSeq,
      sourceStoreId: store.sourceStoreId(),
    };
  } finally {
    store.releaseSyncLease(destination, lease.ownerToken);
  }
}

export async function syncOfficialPublishRecordsIfEnabled(context, {
  requestPage,
  now = Date.now,
} = {}) {
  if (!context?.workDir || !officialPublishStoreEnabled(context.workDir)) {
    return { skipped: true, reason: "store-disabled" };
  }
  const store = getPublishRecordStore(context.workDir);
  const destination = destinationKeyForFactory(context.settings?.url, context.workerId);
  return syncOfficialPublishRecordsRound({
    store,
    workerId: context.workerId,
    destinationKey: destination,
    requestPage: requestPage || ((body) => defaultRequestPage(context, body)),
    now,
  });
}

async function defaultRequestPage(context, body) {
  const response = await fetch(`${context.settings.url}/api/worker/publish-records/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${context.settings.token}`,
      "content-type": "application/json",
      "x-factory-worker": context.workerId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_SYNC_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 404) {
    throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, retryable: false, data });
  }
  if (!response.ok) {
    throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, retryable: true, data });
  }
  return data;
}

async function sendWithRetry(requestPage, request, { retryDelays, sleep }) {
  let lastError;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      return await requestPage(request);
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable !== false && isRetryableSyncError(error);
      if (!retryable || attempt === retryDelays.length) throw error;
      await sleep(retryDelays[attempt]);
    }
  }
  throw lastError;
}

export function isRetryableSyncError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 401 || status === 404) return false;
  if (status === 429 || status >= 500) return true;
  const name = String(error?.name || "");
  const message = String(error?.message || error || "");
  return name === "AbortError" || /timeout|network|fetch|ECONN|ENOTFOUND|busy/i.test(message);
}
