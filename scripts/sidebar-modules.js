export const FACTORY_CLOUD_ORIGIN = "https://factory.tiktokaitool.com";

export const LOCAL_SIDEBAR_MODULE_IDS = Object.freeze([
  "local-queue",
  "operator-third-party",
  "geelark-profiles",
  "geelark-tasks",
  "geelark-novel-effects",
  "analytics",
  "stats",
  "analytics-settings",
  "accounts"
]);

export const SIDEBAR_MODULES = Object.freeze([
  moduleItem("local-queue", "/local-queue", "本地执行队列", ["admin"]),
  moduleItem("hub", "/", "业务总览", ["admin"]),
  moduleItem("mid-video", "/mid-video", "模板工作台", ["admin"], midVideoGroup()),
  moduleItem("schulte", "/schulte", "舒尔特训练", ["admin"], midVideoGroup()),
  moduleItem("podcast", "/podcast", "播客模板", ["admin"], midVideoGroup()),
  moduleItem("ai", "/ai", "AI 创作", ["admin"], midVideoGroup()),
  moduleItem("asset-usage", "/asset-usage", "素材使用率", ["admin"], midVideoGroup()),
  moduleItem("mid-video-effects", "/mid-video-effects", "数据概览", ["admin"], midVideoGroup()),
  moduleItem("mid-video-ops-report", "/mid-video-ops-report", "运营报表", ["admin"], midVideoGroup()),
  moduleItem("mid-video-publish", "/mid-video-publish", "视频发布", ["admin"], midVideoGroup()),
  moduleItem("novel-strategy", "/novel-strategy", "策略中心", ["admin"], novelPromotionGroup()),
  moduleItem("novel-library", "/novel-library", "小说书单", ["admin"], novelPromotionGroup()),
  moduleItem("novel-effects", "/novel-effects", "数据概览", ["admin"], novelPromotionGroup()),
  moduleItem("novel-ops-report", "/novel-ops-report", "运营报表", ["admin"], novelPromotionGroup()),
  moduleItem("novel-publish", "/novel-publish", "视频发布", ["admin"], novelPromotionGroup()),
  moduleItem("operator-official", "/operator/official", "小说自运营", ["admin"], novelPromotionGroup()),
  moduleItem("tasks", "/tasks", "Reddit 自动发布", ["admin"], novelPromotionGroup()),
  moduleItem("psychology-topics", "/psychology-topics", "心理学题目", ["admin"], psychologyGroup()),
  moduleItem("psychology", "/psychology", "心理学视频自动化", ["admin"], psychologyGroup()),
  moduleItem("psychology-effects", "/psychology-effects", "数据概览", ["admin"], psychologyGroup()),
  moduleItem("psychology-ops-report", "/psychology-ops-report", "运营报表", ["admin"], psychologyGroup()),
  moduleItem("psychology-publish", "/psychology-publish", "视频发布", ["admin"], psychologyGroup()),
  moduleItem("tiktok-connections", "/tiktok-connections", "TikTok 账号", ["admin"], officialChannelGroup()),
  moduleItem("official-analytics", "/official-analytics", "授权账号数据", ["admin"], officialChannelGroup()),
  moduleItem("official-publish-records", "/official-publish-records", "官方发布记录", ["admin"], officialChannelGroup()),
  moduleItem("operator-third-party", "/operator/third-party", "小说自运营 · GeeLark 备用", ["admin"], geelarkBackupGroup()),
  moduleItem("geelark-profiles", "/geelark-profiles", "GeeLark 账户配置", ["admin"], geelarkBackupGroup()),
  moduleItem("geelark-tasks", "/geelark-tasks", "GeeLark · Reddit 自动发布", ["admin", "operator"], geelarkBackupGroup()),
  moduleItem("geelark-novel-effects", "/geelark-novel-effects", "GeeLark · 小说效果", ["admin"], geelarkBackupGroup()),
  moduleItem("analytics", "/analytics", "GeeLark · 数据总览", ["admin", "operator"], geelarkBackupGroup()),
  moduleItem("stats", "/stats", "GeeLark · 发布记录", ["admin", "operator"], geelarkBackupGroup()),
  moduleItem("analytics-settings", "/analytics-settings", "GeeLark · 抓取配置", ["admin"], geelarkBackupGroup()),
  moduleItem("work-journal", "/work-journal", "工作记录", ["admin"]),
  moduleItem("accounts", "/accounts", "账户管理", ["admin"])
]);

export function isLocalSidebarModule(moduleId) {
  return LOCAL_SIDEBAR_MODULE_IDS.includes(moduleId);
}

export function sidebarModuleIdsForRole(role) {
  return SIDEBAR_MODULES
    .filter((item) => item.roles.includes(role) && isLocalSidebarModule(item.id))
    .map((item) => item.id);
}

export function publicSidebarModules() {
  return SIDEBAR_MODULES.filter((item) => isLocalSidebarModule(item.id)).map(({ id, href, label, roles, group }) => ({
    id,
    href,
    label,
    roles: [...roles],
    group: group ? { ...group } : null
  }));
}

export function visibleSidebarModules(user) {
  const selected = new Set(Array.isArray(user?.sidebarModules) ? user.sidebarModules : []);
  return SIDEBAR_MODULES.filter((item) => item.roles.includes(user?.role) && selected.has(item.id));
}

export function homePathForUser(user) {
  const visible = visibleSidebarModules(user);
  if (user?.role === "admin") {
    return visible.find((item) => item.id === "local-queue")?.href || visible[0]?.href || "/local-queue";
  }
  return visible[0]?.href || "";
}

export function factoryCloudPageUrl(pathname, search = "") {
  const clean = String(pathname || "/").startsWith("/") ? String(pathname || "/") : `/${pathname}`;
  return `${FACTORY_CLOUD_ORIGIN}${clean}${search || ""}`;
}

export function shouldRedirectLocalPageToFactory(pathname) {
  const clean = String(pathname || "").replace(/\/$/, "") || "/";
  if (clean === "/") return false;
  return SIDEBAR_MODULES.some((item) => item.href === clean && !isLocalSidebarModule(item.id))
    || [
      "/novel-audio",
      "/novel-rewrite",
      "/rewrite-records",
      "/official-account-detail",
      "/official-account-videos",
      "/official-video-detail",
      "/official-group-report",
      "/ops-report",
      "/novel-ops-report",
      "/mid-video-effects",
      "/mid-video-ops-report",
      "/mid-video-publish",
      "/psychology-effects",
      "/psychology-ops-report",
      "/psychology-publish",
      "/novel-publish",
      "/reddit",
      "/asset-cutter",
      "/work-journal-mindmap"
    ].includes(clean);
}

function moduleItem(id, href, label, roles, group = null) {
  return Object.freeze({ id, href, label, roles: Object.freeze([...roles]), group });
}

function midVideoGroup() {
  return Object.freeze({ id: "mid-video", label: "中视频" });
}

function novelPromotionGroup() {
  return Object.freeze({ id: "novel-promotion", label: "小说推文" });
}

function psychologyGroup() {
  return Object.freeze({ id: "psychology", label: "心理学" });
}

function officialChannelGroup() {
  return Object.freeze({ id: "official-channel", label: "官方通道" });
}

function geelarkBackupGroup() {
  return Object.freeze({ id: "geelark-backup", label: "GeeLark 备用" });
}
