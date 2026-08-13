export const SIDEBAR_MODULES = Object.freeze([
  moduleItem("psychology-topics", "/psychology-topics", "心理学题目", ["admin"]),
  moduleItem("psychology", "/psychology", "心理学视频自动化", ["admin"]),
  moduleItem("schulte", "/schulte", "舒尔特训练", ["admin"]),
  moduleItem("ai", "/ai", "AI 创作", ["admin"]),
  moduleItem("asset-usage", "/asset-usage", "素材使用率", ["admin"]),
  moduleItem("tasks", "/tasks", "Reddit 自动发布", ["admin", "operator"]),
  moduleItem("analytics", "/analytics", "GeeLark · 数据总览", ["admin", "operator"]),
  moduleItem("stats", "/stats", "GeeLark · 发布记录", ["admin", "operator"]),
  moduleItem("official-publish-records", "/official-publish-records", "官方 API 发布记录", ["admin"]),
  moduleItem("official-analytics", "/official-analytics", "授权账号", ["admin"]),
  moduleItem("operator-third-party", "/operator/third-party", "小说自运营 · 第三方", ["admin"]),
  moduleItem("operator-official", "/operator/official", "小说自运营 · 官方 API", ["admin"]),
  moduleItem("novel-effects", "/novel-effects", "小说效果", ["admin"]),
  moduleItem("novel-library", "/novel-library", "小说书单", ["admin"]),
  moduleItem("tiktok-connections", "/tiktok-connections", "TikTok 账号", ["admin"]),
  moduleItem("analytics-settings", "/analytics-settings", "抓取配置", ["admin"]),
  moduleItem("accounts", "/accounts", "账户管理", ["admin"])
]);

export function sidebarModuleIdsForRole(role) {
  return SIDEBAR_MODULES.filter((item) => item.roles.includes(role)).map((item) => item.id);
}

export function publicSidebarModules() {
  return SIDEBAR_MODULES.map(({ id, href, label, roles }) => ({ id, href, label, roles: [...roles] }));
}

function moduleItem(id, href, label, roles) {
  return Object.freeze({ id, href, label, roles: Object.freeze([...roles]) });
}
