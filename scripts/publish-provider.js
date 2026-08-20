export const PUBLISH_PROVIDER_GEELARK = "geelark";
export const PUBLISH_PROVIDER_OFFICIAL = "official";

export function normalizePublishProvider(value) {
  return value === PUBLISH_PROVIDER_OFFICIAL ? PUBLISH_PROVIDER_OFFICIAL : PUBLISH_PROVIDER_GEELARK;
}

export function assertPublishProviderAccess(user, provider, options = {}) {
  const normalized = normalizePublishProvider(provider);
  if (normalized === PUBLISH_PROVIDER_OFFICIAL && user?.role !== "admin" && !options.generateOnly) {
    throw Object.assign(new Error("仅管理员可以使用 TikTok 官方 API 发布通道。"), { statusCode: 403 });
  }
  return normalized;
}

export function filterOfficialPublishAccounts(accounts) {
  return (Array.isArray(accounts) ? accounts : []).filter((account) => (
    Array.isArray(account?.scopes) && account.scopes.includes("video.publish")
  ));
}

export function getPublishAccountIds(publish = {}) {
  return normalizePublishProvider(publish.provider) === PUBLISH_PROVIDER_OFFICIAL
    ? (Array.isArray(publish.connectionIds) ? publish.connectionIds : []).map(String).filter(Boolean)
    : (Array.isArray(publish.envIds) ? publish.envIds : []).map(String).filter(Boolean);
}
