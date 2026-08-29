export function attachPublishRiskMarks(accounts, riskAccounts) {
  const byId = new Map();
  for (const item of Array.isArray(riskAccounts) ? riskAccounts : []) {
    const risk = item?.publishRisk;
    if (!risk?.flagged) continue;
    const connectionId = String(item.connectionId || item.id || "").trim();
    const schema = String(item.schema || (connectionId ? `tiktok:${connectionId}` : "")).trim();
    if (connectionId) byId.set(connectionId, risk);
    if (schema) byId.set(schema, risk);
    if (schema.startsWith("tiktok:")) byId.set(schema.slice("tiktok:".length), risk);
  }
  return (Array.isArray(accounts) ? accounts : []).map((account) => {
    const connectionId = String(account.connectionId || account.id || "").trim();
    const schema = String(account.schema || account.username || (connectionId ? `tiktok:${connectionId}` : "")).trim();
    const risk = byId.get(connectionId) || byId.get(schema) || (schema.startsWith("tiktok:") ? byId.get(schema.slice("tiktok:".length)) : null);
    return risk ? { ...account, publishRisk: risk } : account;
  });
}
