# MCP native form Origin follow-up

## Goal
Resolve the user's continued “不允许跨站请求” after the ChatGPT-origin allowlist fix.

## Root cause and evidence
Previous tests manually supplied same-origin Origin and missed native browser behavior. Production /factory-mcp returned Referrer-Policy:no-referrer. Chrome 152 native POST form reproduction with that actual policy sent Origin:null. MDN documents this effect for navigate-mode form submissions. The MCP wrapper correctly rejected null, so consent failed regardless of ChatGPT allowlisting.

## Change
factory-mcp.js page helper now emits strict-origin, retaining only site origin as Referer with no path/query leakage. Same-origin checks, CSRF, consent handles, null/malicious-origin rejection and CSP form-action self remain intact. Documentation updated.

## Verification
factory-mcp.test.js adds a real isolated headless Chromium form test: old no-referrer → null; strict-origin → Factory origin and origin-only Referer. Requests intercepted locally, no real grants, tokens or external submits. Browser availability is detected for portable CI; response-header contract always checked. The real consent HTML also runs through Chromium and the actual OAuth provider against the in-memory fixture; clicking approve reaches the authorization-success page. Existing PKCE/MCP and null-origin negative tests retained. Full npm test: 859 passed, 0 failed; diff check passed.

## Deployment and live verification
Code commit 6bfbc16 was pushed to main, then deployed from the clean release checkout with HEAD equal to origin/main using npm run deploy. Worker version: 09af8cb5-26ce-4309-aed4-58c170c7be0e. The first attempt returned Cloudflare D1 7403; authenticated account was checked and the standard deploy retry succeeded without changing credentials. Production /factory-mcp now returns strict-origin. An isolated Chrome native form using that live response policy sends the correct same-origin Origin and origin-only Referer.

## Remaining user step
Close the already-loaded stale authorization page and start Connect again in ChatGPT. The user's real ChatGPT connection has not been confirmed; the complete consent flow passed in the local browser fixture. No paid generation or publishing performed.
