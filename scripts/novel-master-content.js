import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE_URL = "https://web.novel-master.com/";
const DEFAULT_CHROME_PATH = "C:/Program Files/Google/Chrome/Application/chrome.exe";

export async function scrapeNovelMasterBooks({ books, outputDir, jobPath, chromePath = DEFAULT_CHROME_PATH }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const pendingBooks = Array.isArray(books)
    ? books.filter((book) => String(book?.bookId || "").trim())
    : [];
  const initial = readJob(jobPath);
  const results = Array.isArray(initial.results) ? initial.results : [];
  const completedIds = new Set(
    results.filter((item) => item.status === "success").map((item) => String(item.bookId))
  );
  let browser;

  updateJob(jobPath, {
    status: "running",
    total: pendingBooks.length,
    completed: completedIds.size,
    message: "Starting Novel Master public chapter reader...",
    startedAt: initial.startedAt || Date.now(),
    results
  });

  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,900"
      ]
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      + "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const type = request.resourceType();
      const isTrackingRequest = ["xhr", "fetch", "eventsource", "ping"].includes(type)
        && /google|facebook|doubleclick|stripe|sentry/i.test(request.url());
      if (["image", "media", "font"].includes(type) || isTrackingRequest) request.abort();
      else request.continue();
    });

    for (let index = 0; index < pendingBooks.length; index++) {
      const book = pendingBooks[index];
      const bookId = String(book.bookId).trim();
      if (completedIds.has(bookId) || fs.existsSync(contentPath(outputDir, bookId))) {
        if (!completedIds.has(bookId)) {
          results.push({ bookId, title: book.title, status: "success", cached: true });
        }
        completedIds.add(bookId);
        updateProgress(jobPath, pendingBooks, index + 1, results, book, "Using local cache");
        continue;
      }

      updateJob(jobPath, {
        currentIndex: index + 1,
        currentBookId: bookId,
        currentTitle: book.title,
        message: `Reading ${index + 1}/${pendingBooks.length}: ${book.title || bookId}`
      });

      try {
        const scraped = await scrapeOneBook(page, book);
        const record = {
          ...scraped,
          sourceTitle: String(book.title || ""),
          sourceBookId: bookId,
          sourceSheet: String(book.sheetTitle || ""),
          sourceRow: Number(book.rowNumber) || 0,
          fetchedAt: new Date().toISOString()
        };
        fs.writeFileSync(contentPath(outputDir, bookId), JSON.stringify(record, null, 2), "utf8");
        results.push({
          bookId,
          title: book.title,
          matchedTitle: record.matchedTitle,
          status: "success",
          freeChapters: record.freeChapterCount,
          characterCount: record.characterCount
        });
        completedIds.add(bookId);
      } catch (error) {
        const message = String(error?.message || error);
        const status = /not found|no exact match/i.test(message) ? "not_found" : "failed";
        results.push({ bookId, title: book.title, status, error: message.slice(0, 500) });
      }

      updateProgress(jobPath, pendingBooks, index + 1, results, book);
      await delay(650);
    }

    const summary = summarize(results, pendingBooks.length);
    updateJob(jobPath, {
      ...summary,
      status: "completed",
      percent: 100,
      message: `Completed: ${summary.success} success, ${summary.notFound} not found, ${summary.failed} failed`,
      finishedAt: Date.now(),
      results
    });
  } catch (error) {
    updateJob(jobPath, {
      status: "failed",
      message: String(error?.message || error),
      error: String(error?.stack || error),
      finishedAt: Date.now(),
      results
    });
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function scrapeOneBook(page, book) {
  const bookId = String(book?.bookId || "").trim();
  if (!bookId) throw new Error("Book ID is missing");

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(
    () => document.readyState !== "loading" && document.body?.innerText?.length > 20,
    { timeout: 25_000 }
  );

  let input = await page.$('input[placeholder="Search for novel"]');
  if (!input) {
    await delay(1_500);
    if (!await page.$('[class*="searchWrapper"]')) throw new Error("Novel Master search launcher not found");
    await page.click('[class*="searchWrapper"]');
    try {
      await page.waitForSelector('input[placeholder="Search for novel"]', { timeout: 5_000 });
    } catch {
      await page.click('[class*="searchWrapper"]');
      await page.waitForSelector('input[placeholder="Search for novel"]', { timeout: 15_000 });
    }
    input = await page.$('input[placeholder="Search for novel"]');
  }
  if (!input) throw new Error("Novel Master search input not found");

  await input.click({ clickCount: 3 });
  await input.type(bookId, { delay: 15 });
  const confirmed = await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll("div,button")).find(
      (element) => element.textContent?.trim() === "Confirm"
    );
    target?.click();
    return Boolean(target);
  });
  if (!confirmed) throw new Error("Novel Master search confirm button not found");

  await page.waitForFunction(
    () => document.body.innerText.includes("Are you looking for the book again?")
      || document.body.innerText.includes("-no more data-"),
    { timeout: 25_000 }
  );
  const matchTitle = await page.evaluate(() => {
    if (!document.body.innerText.includes("Are you looking for the book again?")) return "";
    const viewButton = Array.from(document.querySelectorAll("button")).find(
      (element) => element.textContent?.trim().toLowerCase() === "view"
    );
    const dialogText = viewButton?.parentElement?.innerText || document.body.innerText;
    return dialogText
      .split("\n")
      .map((value) => value.trim())
      .find((value) => value && !["Are you looking for the book again?", "cancel", "view"].includes(value)) || "";
  });
  if (!matchTitle) throw new Error("No exact match for this book ID");

  const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
  const viewed = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (element) => element.textContent?.trim().toLowerCase() === "view"
    );
    button?.click();
    return Boolean(button);
  });
  if (!viewed) throw new Error("Matched book view button not found");
  await navigation;

  await page.waitForFunction(
    () => Boolean(window.store?.getState?.().details?.shortDetails?.content),
    { timeout: 30_000 }
  );
  const details = await page.evaluate(() => {
    const value = window.store?.getState?.().details?.shortDetails || {};
    return {
      id: value.id,
      title: value.title,
      intro: value.intro || value.description || "",
      content: value.content || "",
      type: value.type || "",
      cutoffSegment: value.cutoff_segment || "",
      isSelfBook: Boolean(value.is_self_book)
    };
  });
  const freeContent = extractFreeContent(details);
  if (!freeContent) throw new Error("Matched book has no readable public content");
  const chapterNumbers = freeContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d{1,3}$/.test(line));

  return {
    novelId: String(details.id || ""),
    matchedTitle: String(details.title || matchTitle),
    intro: String(details.intro || ""),
    freeContent,
    freeChapterCount: chapterNumbers.length || 1,
    characterCount: freeContent.length,
    wordCount: freeContent.trim().split(/\s+/).filter(Boolean).length,
    paywallDetected: Boolean(details.cutoffSegment && details.content.includes(details.cutoffSegment)),
    sourceUrl: page.url()
  };
}

export function extractFreeContent(details) {
  const content = String(details?.content || "").replace(/\r\n/g, "\n").trim();
  const cutoff = String(details?.cutoffSegment || "");
  if (!content) return "";
  if (cutoff && content.includes(cutoff) && String(details?.type || "") !== "free") {
    return content.split(cutoff)[0].trim();
  }
  return content;
}

export function readNovelContent(outputDir, bookId) {
  const filePath = contentPath(outputDir, bookId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function getNovelContentSummary(outputDir, bookIds = []) {
  const records = bookIds.map((bookId) => readNovelContent(outputDir, bookId)).filter(Boolean);
  return {
    cached: records.length,
    totalCharacters: records.reduce((sum, record) => sum + (Number(record.characterCount) || 0), 0),
    records: records.map((record) => ({
      bookId: record.sourceBookId,
      matchedTitle: record.matchedTitle,
      freeChapterCount: record.freeChapterCount,
      characterCount: record.characterCount,
      fetchedAt: record.fetchedAt
    }))
  };
}

function updateProgress(jobPath, books, completed, results, book, customMessage = "") {
  const summary = summarize(results, books.length);
  updateJob(jobPath, {
    ...summary,
    completed,
    percent: Math.max(1, Math.round((completed / Math.max(1, books.length)) * 100)),
    currentIndex: completed,
    currentBookId: String(book.bookId || ""),
    currentTitle: String(book.title || ""),
    message: customMessage || `Processed ${completed}/${books.length}: ${summary.success} success, ${summary.notFound} not found, ${summary.failed} failed`,
    results
  });
}

function summarize(results, total) {
  return {
    total,
    success: results.filter((item) => item.status === "success").length,
    notFound: results.filter((item) => item.status === "not_found").length,
    failed: results.filter((item) => item.status === "failed").length
  };
}

function contentPath(outputDir, bookId) {
  return path.join(outputDir, `${String(bookId).replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

function readJob(jobPath) {
  try {
    return JSON.parse(fs.readFileSync(jobPath, "utf8"));
  } catch {
    return {};
  }
}

function updateJob(jobPath, patch) {
  const next = { ...readJob(jobPath), ...patch, updatedAt: Date.now() };
  fs.writeFileSync(jobPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
