export const SIDEBAR_MODULES = Object.freeze([
  moduleItem("hub", "/", "业务总览", ["admin"]),
  moduleItem("mid-video", "/mid-video", "模板工作台", ["admin"], midVideoGroup()),
  moduleItem("schulte", "/schulte", "舒尔特训练", ["admin"], midVideoGroup()),
  moduleItem("podcast", "/podcast", "播客模板", ["admin"], midVideoGroup()),
  moduleItem("ai", "/ai", "AI 创作", ["admin"], midVideoGroup()),
  moduleItem("asset-usage", "/asset-usage", "素材使用率", ["admin"], midVideoGroup()),
  moduleItem("novel-strategy", "/novel-strategy", "策略中心", ["admin"], novelPromotionGroup()),
  moduleItem("novel-library", "/novel-library", "小说书单", ["admin"], novelPromotionGroup()),
  moduleItem("novel-effects", "/novel-effects", "数据概览", ["admin"], novelPromotionGroup()),
  moduleItem("operator-official", "/operator/official", "小说自运营", ["admin"], novelPromotionGroup()),
  moduleItem("tasks", "/tasks", "Reddit 自动发布", ["admin"], novelPromotionGroup()),
  moduleItem("psychology-topics", "/psychology-topics", "心理学题目", ["admin"], psychologyGroup()),
  moduleItem("psychology", "/psychology", "心理学视频自动化", ["admin"], psychologyGroup()),
  moduleItem("tiktok-connections", "/tiktok-connections", "TikTok 账号", ["admin"], officialChannelGroup()),
  moduleItem("official-analytics", "/official-analytics", "授权账号数据", ["admin"], officialChannelGroup()),
  moduleItem("official-publish-records", "/official-publish-records", "官方发布记录", ["admin"], officialChannelGroup()),
  moduleItem("operator-third-party", "/operator/third-party", "小说自运营 · GeeLark 备用", ["admin"], geelarkBackupGroup()),
  moduleItem("geelark-tasks", "/geelark-tasks", "GeeLark · Reddit 自动发布", ["admin", "operator"], geelarkBackupGroup()),
  moduleItem("geelark-novel-effects", "/geelark-novel-effects", "GeeLark · 小说效果", ["admin"], geelarkBackupGroup()),
  moduleItem("analytics", "/analytics", "GeeLark · 数据总览", ["admin", "operator"], geelarkBackupGroup()),
  moduleItem("stats", "/stats", "GeeLark · 发布记录", ["admin", "operator"], geelarkBackupGroup()),
  moduleItem("analytics-settings", "/analytics-settings", "GeeLark · 抓取配置", ["admin"], geelarkBackupGroup()),
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
  if (user?.role === "admin") return "/";
  return visibleSidebarModules(user)[0]?.href || "";
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
