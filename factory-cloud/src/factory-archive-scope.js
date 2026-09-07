import { kvGet } from "./kv.js";
import { factoryArchiveKeys } from "../../scripts/factory-archive-scope.js";

export async function loadFactoryArchiveScope(db) {
  const store = await kvGet(db, "official-account-groups", {});
  const { results } = await db.prepare("SELECT account_key, group_id FROM official_account_assignments").all();
  const assignments = Object.fromEntries((results || []).map(row => [row.account_key, row.group_id]));
  // Canonical assignments are authoritative; never revive removed legacy grants.
  return factoryArchiveKeys({ ...store, assignments });
}
