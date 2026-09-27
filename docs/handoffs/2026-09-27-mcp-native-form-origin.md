# MCP native form Origin follow-up

## Goal
Resolve the user's continued “不允许跨站请求” after the ChatGPT-origin allowlist fix.

## Root cause and evidence
Previous tests manually supplied same-origin Origin and missed native browser behavior. Production /factory-mcp returned Referrer-Policy:no-referrer. Chrome 152 native POST form reproduction with that actual policy sent Origin:null. MDN documents this effect for navigate-mode form submissions. The MCP wrapper correctly rejected null, so consent failed regardless of ChatGPT allowlisting.

## Change
factory-mcp.js page helper now emits strict-origin, retaining only site origin as Referer with no path/query leakage. Same-origin checks, CSRF, consent handles, null/malicious-origin rejection and CSP form-action self remain intact. Documentation updated.

## Verification
factory-mcp.test.js adds a real isolated headless Chromium form test: old no-referrer → null; strict-origin → Factory origin and origin-only Referer. Requests intercepted locally, no real grants, tokens or external submits. Browser availability is detected for portable CI; response-header contract always checked. The real consent HTML also runs through Chromium and the actual OAuth provider against the in-memory fixture; clicking approve reaches the authorization-success page. Existing PKCE/MCP and null-origin negative tests retained. Full npm test: 859 passed, 0 failed; diff check passed.

## Next step
After deploy, verify production header and re-run isolated browser reproduction using the live header. User must close the already-loaded stale authorization page and start Connect again in ChatGPT. No paid generation or publishing performed.
