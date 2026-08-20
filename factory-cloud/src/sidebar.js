const ALL = ["admin", "operator"];

export const SIDEBAR_MODULES = Object.freeze([
  // 新模块默认只给 admin。不要把 operator 加进新功能，除非用户明确要求。
  moduleItem("hub", "/", "业务总览", ALL),
  moduleItem("mid-video", "/mid-video", "模板工作台", ALL, midVideoGroup()),
  moduleItem("schulte", "/schulte", "舒尔特训练", ALL, midVideoGroup()),
  moduleItem("podcast", "/podcast", "播客模板", ALL, midVideoGroup()),
  moduleItem("ai", "/ai", "AI 创作", ALL, midVideoGroup()),
  moduleItem("asset-usage", "/asset-usage", "素材使用率", ALL, midVideoGroup()),
  moduleItem("mid-video-effects", "/mid-video-effects", "数据概览", ALL, midVideoGroup()),
  moduleItem("mid-video-ops-report", "/mid-video-ops-report", "运营报表", ALL, midVideoGroup()),
  moduleItem("mid-video-publish", "/mid-video-publish", "视频发布", ALL, midVideoGroup()),
  moduleItem("novel-strategy", "/novel-strategy", "策略中心", ALL, novelPromotionGroup()),
  moduleItem("novel-library", "/novel-library", "小说书单", ALL, novelPromotionGroup()),
  moduleItem("novel-effects", "/novel-effects", "数据概览", ALL, novelPromotionGroup()),
  moduleItem("novel-ops-report", "/novel-ops-report", "运营报表", ALL, novelPromotionGroup()),
  moduleItem("operator-official", "/operator/official", "小说自运营", ALL, novelPromotionGroup()),
  moduleItem("tasks", "/tasks", "Reddit 自动发布", ALL, novelPromotionGroup()),
  moduleItem("psychology-topics", "/psychology-topics", "心理学题目", ALL, psychologyGroup()),
  moduleItem("psychology", "/psychology", "心理学视频自动化", ALL, psychologyGroup()),
  moduleItem("psychology-effects", "/psychology-effects", "数据概览", ALL, psychologyGroup()),
  moduleItem("psychology-ops-report", "/psychology-ops-report", "运营报表", ALL, psychologyGroup()),
  moduleItem("psychology-publish", "/psychology-publish", "视频发布", ALL, psychologyGroup()),
  moduleItem("tiktok-connections", "/tiktok-connections", "TikTok 账号", ALL, officialChannelGroup()),
  moduleItem("official-analytics", "/official-analytics", "授权账号数据", ALL, officialChannelGroup()),
  moduleItem("official-publish-records", "/official-publish-records", "官方发布记录", ALL, officialChannelGroup()),
  moduleItem("operator-third-party", "/operator/third-party", "小说自运营 · GeeLark 备用", ALL, geelarkBackupGroup()),
  moduleItem("geelark-profiles", "/geelark-profiles", "GeeLark 账户配置", ["admin"], geelarkBackupGroup()),
  moduleItem("geelark-tasks", "/geelark-tasks", "GeeLark · Reddit 自动发布", ALL, geelarkBackupGroup()),
  moduleItem("geelark-novel-effects", "/geelark-novel-effects", "GeeLark · 小说效果", ALL, geelarkBackupGroup()),
  moduleItem("analytics", "/analytics", "GeeLark · 数据总览", ALL, geelarkBackupGroup()),
  moduleItem("stats", "/stats", "GeeLark · 发布记录", ALL, geelarkBackupGroup()),
  moduleItem("analytics-settings", "/analytics-settings", "GeeLark · 抓取配置", ALL, geelarkBackupGroup()),
  moduleItem("work-journal", "/work-journal", "工作记录", ALL),
  moduleItem("accounts", "/accounts", "账户管理", ["admin"])
]);

export function sidebarModuleIdsForRole(role) {
  return SIDEBAR_MODULES.filter((item) => item.roles.includes(role)).map((item) => item.id);
}

export function publicSidebarModules() {
  return SIDEBAR_MODULES.map(({ id, href, label, roles, group }) => ({
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
  if (user?.role === "admin") return visible.find((item) => item.id === "hub")?.href || visible[0]?.href || "/";
  return visible[0]?.href || "";
}

export function moduleIdForPath(pathname) {
  const clean = String(pathname || "").replace(/\/$/, "") || "/";
  const aliases = {
    "/official-account-detail": "official-analytics",
    "/official-account-videos": "official-analytics",
    "/official-video-detail": "official-analytics",
    "/novel-rewrite": "novel-library",
    "/novel-audio": "novel-library",
    "/rewrite-records": "novel-library",
    "/operator": "operator-official",
    "/ops-report": "novel-ops-report",
    "/official-group-report": "novel-ops-report",
    "/work-journal-mindmap": "work-journal",
  };
  if (aliases[clean]) return aliases[clean];
  return SIDEBAR_MODULES.find((item) => item.href === clean)?.id || "";
}

const ACCOUNT_DATA_MODULES = Object.freeze(["official-analytics", "mid-video-effects", "psychology-effects"]);
const ACCOUNT_DATA_DETAIL_PATHS = Object.freeze(["/official-account-detail", "/official-account-videos", "/official-video-detail"]);

export function canAccessPath(user, pathname) {
  if (!user) return false;
  const clean = String(pathname || "").replace(/\/$/, "") || "/";
  if (ACCOUNT_DATA_DETAIL_PATHS.includes(clean)) {
    return (user.sidebarModules || []).some((moduleId) => ACCOUNT_DATA_MODULES.includes(moduleId));
  }
  const moduleId = moduleIdForPath(pathname);
  if (!moduleId) return true;
  if (moduleId === "accounts" || moduleId === "geelark-profiles") return user.role === "admin";
  return (user.sidebarModules || []).includes(moduleId);
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
