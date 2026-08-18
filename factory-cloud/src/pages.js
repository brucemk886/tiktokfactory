const PAGE_FILES = {
  "/": "hub.html",
  "/work-journal": "work-journal.html",
  "/login": "login.html",
  "/setup": "setup.html",
  "/accounts": "accounts.html",
  "/mid-video": "mid-video.html",
  "/podcast": "index.html",
  "/schulte": "schulte.html",
  "/ai": "ai.html",
  "/asset-usage": "asset-usage.html",
  "/novel-strategy": "novel-strategy.html",
  "/novel-library": "novel-library.html",
  "/novel-effects": "novel-effects.html",
  "/novel-audio": "novel-audio.html",
  "/novel-rewrite": "novel-rewrite.html",
  "/rewrite-records": "rewrite-records.html",
  "/operator": "operator.html",
  "/operator/official": "operator.html",
  "/operator/third-party": "operator.html",
  "/tasks": "tasks.html",
  "/geelark-tasks": "tasks.html",
  "/psychology": "psychology.html",
  "/psychology-topics": "psychology-topics.html",
  "/tiktok-connections": "tiktok-connections.html",
  "/official-analytics": "official-analytics.html",
  "/official-publish-records": "official-publish-records.html",
  "/official-account-detail": "official-account-detail.html",
  "/official-account-videos": "official-account-videos.html",
  "/official-video-detail": "official-video-detail.html",
  "/geelark-novel-effects": "novel-effects.html",
  "/analytics": "analytics.html",
  "/analytics-settings": "analytics-settings.html",
  "/stats": "stats.html",
  "/reddit": "reddit.html",
  "/asset-cutter": "asset-cutter.html"
};

const PUBLIC_PATHS = new Set(["/login", "/setup", "/login.js", "/setup.js", "/app.css", "/access.css", "/theme-ops.css"]);

export function pageFileFor(pathname) {
  if (PAGE_FILES[pathname]) return PAGE_FILES[pathname];
  return "";
}

export function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname);
}

export function rewriteAssetRequest(request, url, fileName) {
  const next = new URL(url);
  next.pathname = `/${fileName}`;
  return new Request(next, request);
}
