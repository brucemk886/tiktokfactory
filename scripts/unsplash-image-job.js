import fs from "node:fs";
import path from "node:path";

const [, , payloadPath, jobPath] = process.argv;
const payload = readJson(payloadPath, {});

main().catch((error) => {
  patchJob({
    status: "failed",
    percent: 100,
    message: error.message || "Unsplash image download failed.",
    updatedAt: Date.now()
  });
});

async function main() {
  const accessKey = String(payload.accessKey || "").trim();
  const outputDir = String(payload.outputDir || "").trim();
  const keywords = parseKeywords(payload.keywords);
  const targetCount = clamp(Number(payload.count) || 1000, 1, 5000);
  const perPage = clamp(Number(payload.perPage) || 30, 1, 30);
  const orientation = ["portrait", "landscape", "squarish"].includes(payload.orientation) ? payload.orientation : "portrait";
  const imageSize = ["raw", "full", "regular", "small"].includes(payload.imageSize) ? payload.imageSize : "regular";
  const delayMs = clamp(Number(payload.delayMs) || 350, 0, 10000);

  if (!accessKey) throw new Error("Please enter an Unsplash Access Key.");
  if (!keywords.length) throw new Error("Please enter at least one keyword.");
  if (!outputDir) throw new Error("Please enter an image output folder.");

  fs.mkdirSync(outputDir, { recursive: true });

  const state = {
    downloaded: 0,
    searchedPages: 0,
    skipped: 0,
    errors: [],
    keywordPages: Object.fromEntries(keywords.map((keyword) => [keyword, 1])),
    seenPhotoIds: new Set()
  };

  patchJob({
    status: "running",
    percent: 1,
    message: `Starting Unsplash download: 0/${targetCount}`,
    outputDir,
    downloaded: 0,
    targetCount,
    updatedAt: Date.now()
  });

  let keywordIndex = 0;
  let emptyRounds = 0;
  while (state.downloaded < targetCount && emptyRounds < keywords.length * 4) {
    assertNotCanceled();
    const keyword = keywords[keywordIndex % keywords.length];
    keywordIndex += 1;
    const before = state.downloaded;
    await searchAndDownloadKeyword({
      accessKey,
      outputDir,
      keyword,
      page: state.keywordPages[keyword],
      perPage,
      orientation,
      imageSize,
      delayMs,
      targetCount,
      state
    });
    state.keywordPages[keyword] += 1;
    emptyRounds = state.downloaded > before ? 0 : emptyRounds + 1;
  }

  patchJob({
    status: "done",
    percent: 100,
    message: `Downloaded ${state.downloaded}/${targetCount} images.`,
    downloaded: state.downloaded,
    skipped: state.skipped,
    errors: state.errors.slice(-12),
    outputDir,
    updatedAt: Date.now()
  });
}

async function searchAndDownloadKeyword(options) {
  const { accessKey, outputDir, keyword, page, perPage, orientation, imageSize, delayMs, targetCount, state } = options;
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", keyword);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", orientation);
  url.searchParams.set("content_filter", "high");

  const data = await unsplashJsonWithRateLimit(url, accessKey, state, targetCount);
  state.searchedPages += 1;
  const results = Array.isArray(data.results) ? data.results : [];
  if (!results.length) {
    patchProgress(state, targetCount, `No more results for "${keyword}" page ${page}.`);
    return;
  }

  for (const photo of results) {
    assertNotCanceled();
    if (state.downloaded >= targetCount) break;
    if (!photo?.id || state.seenPhotoIds.has(photo.id)) {
      state.skipped += 1;
      continue;
    }
    state.seenPhotoIds.add(photo.id);
    try {
      await downloadPhoto({ accessKey, photo, outputDir, keyword, imageSize, state, targetCount });
      state.downloaded += 1;
      patchProgress(state, targetCount, `Downloading "${keyword}": ${state.downloaded}/${targetCount}`);
      if (delayMs) await delay(delayMs);
    } catch (error) {
      state.skipped += 1;
      state.errors.push(`${photo.id}: ${error.message || error}`);
      patchProgress(state, targetCount, `Skipped one image: ${error.message || error}`);
    }
  }
}

async function downloadPhoto({ accessKey, photo, outputDir, keyword, imageSize, state, targetCount }) {
  const downloadLocation = photo.links?.download_location;
  if (!downloadLocation) throw new Error("Missing download_location.");
  const track = await unsplashJsonWithRateLimit(downloadLocation, accessKey, state, targetCount);
  const imageUrl = track.url || photo.urls?.[imageSize] || photo.urls?.regular;
  if (!imageUrl) throw new Error("Missing image URL.");

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) throw new Error("Image file is too small.");

  const keywordDir = path.join(outputDir, safeName(keyword));
  fs.mkdirSync(keywordDir, { recursive: true });
  const ext = imageExtension(response.headers.get("content-type"), imageUrl);
  const author = safeName(photo.user?.username || photo.user?.name || "unsplash");
  const filePath = path.join(keywordDir, `${safeName(photo.id)}-${author}${ext}`);
  if (fs.existsSync(filePath)) return;

  fs.writeFileSync(filePath, buffer);
  fs.writeFileSync(filePath.replace(/\.[^.]+$/, ".json"), JSON.stringify({
    id: photo.id,
    keyword,
    author: photo.user?.name || "",
    username: photo.user?.username || "",
    unsplashUrl: photo.links?.html || "",
    downloadedAt: new Date().toISOString()
  }, null, 2), "utf8");
}

async function unsplashJson(url, accessKey) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      "Accept-Version": "v1"
    }
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 403 && /rate limit/i.test(text)) {
      throw new RateLimitError(resolveRateLimitWaitMs(response), text);
    }
    throw new Error(`Unsplash API failed: ${response.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function unsplashJsonWithRateLimit(url, accessKey, state, targetCount) {
  for (;;) {
    try {
      return await unsplashJson(url, accessKey);
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      await waitForRateLimit(error.waitMs, state, targetCount);
    }
  }
}

async function waitForRateLimit(waitMs, state, targetCount) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    assertNotCanceled();
    const remainingMs = Math.max(0, until - Date.now());
    patchProgress(state, targetCount, `Unsplash rate limit reached. Waiting ${formatWait(remainingMs)} before continuing.`);
    await delay(Math.min(60_000, remainingMs));
  }
}

class RateLimitError extends Error {
  constructor(waitMs, message) {
    super(`Unsplash rate limit exceeded. Waiting ${formatWait(waitMs)}.`);
    this.name = "RateLimitError";
    this.waitMs = waitMs;
    this.detail = message;
  }
}

function resolveRateLimitWaitMs(response) {
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const resetMs = reset > 10_000_000_000 ? reset : reset * 1000;
    const waitMs = resetMs - Date.now() + 30_000;
    if (waitMs > 0) return Math.min(waitMs, 2 * 60 * 60 * 1000);
  }
  return 65 * 60 * 1000;
}

function patchProgress(state, targetCount, message) {
  const percent = Math.max(1, Math.min(99, Math.round((state.downloaded / targetCount) * 100)));
  patchJob({
    status: "running",
    percent,
    message,
    downloaded: state.downloaded,
    targetCount,
    searchedPages: state.searchedPages,
    skipped: state.skipped,
    errors: state.errors.slice(-12),
    updatedAt: Date.now()
  });
}

function assertNotCanceled() {
  const job = readJson(jobPath, {});
  if (job.cancelRequested) {
    patchJob({
      status: "canceled",
      percent: Number(job.percent) || 100,
      message: "Unsplash image download canceled.",
      updatedAt: Date.now()
    });
    process.exit(0);
  }
}

function parseKeywords(value) {
  return String(value || "")
    .split(/[\n,，]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

function safeName(value) {
  return String(value || "image")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "image";
}

function imageExtension(contentType, url) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  const pathname = (() => {
    try { return new URL(url).pathname; } catch { return ""; }
  })();
  const ext = path.extname(pathname).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
}

function formatWait(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath, fallback) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function patchJob(patch) {
  const current = readJson(jobPath, {});
  fs.writeFileSync(jobPath, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}
