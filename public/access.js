const SIDEBAR_MODULE_BY_PATH = Object.freeze({
  "/psychology-topics": "psychology-topics",
  "/psychology": "psychology",
  "/schulte": "schulte",
  "/ai": "ai",
  "/asset-usage": "asset-usage",
  "/tasks": "tasks",
  "/stats": "stats",
  "/analytics": "analytics",
  "/tiktok-video-detail": "analytics",
  "/operator": "operator",
  "/tiktok-connections": "tiktok-connections",
  "/analytics-settings": "analytics-settings",
  "/accounts": "accounts"
});

(async () => {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (!response.ok) return location.assign("/login");
    const { user } = await response.json();
    document.documentElement.dataset.role = user.role;

    if (user.role === "admin") {
      addOperationBrainLinks();
      addTikTokConnectionLinks();
      addTikTokVideoDetailLinks();
    }
    applyRoleVisibility(user);
    applySidebarVisibility(user);

    document.querySelectorAll("[data-account-name]").forEach((item) => {
      item.textContent = user.username;
    });
    document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      location.assign("/login");
    }));
  } catch {
    location.assign("/login");
  }
})();

function addOperationBrainLinks() {
  document.querySelectorAll(".tasks-nav, .side-tabs").forEach((nav) => {
    if (nav.querySelector('a[href="/operator"]')) return;
    const link = document.createElement("a");
    link.href = "/operator";
    link.textContent = "小说 AI 自运营";
    link.dataset.adminOnly = "";
    link.dataset.sidebarModule = "operator";
    if (location.pathname === "/operator") link.className = "is-active";
    const settingsLink = nav.querySelector('a[href="/analytics-settings"]');
    nav.insertBefore(link, settingsLink || null);
  });
}

function addTikTokConnectionLinks() {
  document.querySelectorAll(".tasks-nav, .side-tabs").forEach((nav) => {
    if (nav.querySelector('a[href="/tiktok-connections"]')) return;
    const link = document.createElement("a");
    link.href = "/tiktok-connections";
    link.textContent = "TikTok 官方账号";
    link.dataset.adminOnly = "";
    link.dataset.sidebarModule = "tiktok-connections";
    if (location.pathname === "/tiktok-connections") link.className = "is-active";
    const settingsLink = nav.querySelector('a[href="/analytics-settings"]');
    nav.insertBefore(link, settingsLink || null);
  });
}

function addTikTokVideoDetailLinks() {
  document.querySelectorAll(".tasks-nav, .side-tabs").forEach((nav) => {
    if (nav.querySelector('a[href="/tiktok-video-detail"]')) return;
    const link = document.createElement("a");
    link.href = "/tiktok-video-detail";
    link.textContent = "单条视频数据";
    link.dataset.adminOnly = "";
    link.dataset.sidebarModule = "analytics";
    if (location.pathname === "/tiktok-video-detail") link.className = "is-active";
    const analyticsLink = nav.querySelector('a[href="/analytics"]');
    if (analyticsLink) analyticsLink.insertAdjacentElement("afterend", link);
    else {
      const settingsLink = nav.querySelector('a[href="/analytics-settings"]');
      nav.insertBefore(link, settingsLink || null);
    }
  });
}

function applyRoleVisibility(user) {
  document.querySelectorAll("[data-admin-only]").forEach((item) => {
    item.hidden = user.role !== "admin";
  });
}

function applySidebarVisibility(user) {
  if (!Array.isArray(user.sidebarModules)) return;
  const visibleModules = new Set(user.sidebarModules);
  document.querySelectorAll(".tasks-nav, .side-tabs").forEach((nav) => {
    nav.querySelectorAll("a[href]").forEach((link) => {
      if (link.classList.contains("app-brand") || link.classList.contains("tasks-brand")) return;
      let pathname = "";
      try {
        pathname = new URL(link.href, location.origin).pathname;
      } catch {
        return;
      }
      const moduleId = link.dataset.sidebarModule || SIDEBAR_MODULE_BY_PATH[pathname];
      if (!moduleId) return;
      link.dataset.sidebarModule = moduleId;
      if (!visibleModules.has(moduleId)) link.hidden = true;
    });
  });
}
