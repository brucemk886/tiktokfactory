const TYPES = new Set(["psychology", "psychology-collage", "psychology-target-2", "psychology-narrative"]);

// Never reinterpret GeeLark account IDs as official connections. Old tasks
// without explicit official publishing settings become generation-only.
export function psychologyPublishPayload(type, payload = {}) {
  if (!TYPES.has(type)) return payload;
  const old = payload.publish || {};
  const official = old.provider === "official";
  return {
    ...payload,
    module: "psychology",
    publish: {
      ...old,
      provider: "official",
      autoPublish: official && old.autoPublish !== false,
      envIds: [],
      accounts: [],
      connectionIds: official ? (old.connectionIds || []) : [],
      officialAccounts: official ? (old.officialAccounts || []) : []
    }
  };
}
