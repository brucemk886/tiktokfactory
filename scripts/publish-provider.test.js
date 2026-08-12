import assert from "node:assert/strict";
import {
  assertPublishProviderAccess,
  filterOfficialPublishAccounts,
  getPublishAccountIds,
  normalizePublishProvider,
} from "./publish-provider.js";

assert.equal(normalizePublishProvider("official"), "official");
assert.equal(normalizePublishProvider("unknown"), "geelark");
assert.equal(assertPublishProviderAccess({ role: "admin" }, "official"), "official");
assert.throws(
  () => assertPublishProviderAccess({ role: "member" }, "official"),
  (error) => error?.statusCode === 403 && /仅管理员/.test(error.message)
);
assert.deepEqual(getPublishAccountIds({ provider: "geelark", envIds: ["g1"] }), ["g1"]);
assert.deepEqual(getPublishAccountIds({ provider: "official", connectionIds: ["t1"] }), ["t1"]);
assert.deepEqual(filterOfficialPublishAccounts([
  { id: "a", scopes: ["video.publish"] },
  { id: "b", scopes: ["user.info.basic"] },
]), [{ id: "a", scopes: ["video.publish"] }]);

console.log("publish provider access tests passed");
