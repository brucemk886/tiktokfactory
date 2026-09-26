# ChatGPT MCP Origin fix

## Goal
Fix the user's “不允许跨站请求” on the Factory login/authorization flow.

## Evidence and decisions
Production reproduced 403 with the exact same message for Origin https://chatgpt.com on /mcp, OAuth resource discovery, and /oauth/authorize. Existing outer wrapper rejected all non-Factory origins. User reported the failure after entering the Factory auth page; their exact browser request was not captured.

Allow only exact ChatGPT origin for fixed bearer-authenticated MCP/OAuth protocol endpoints and authorization landing GET. Handle bounded CORS preflights before OAuth. Keep factory-cookie approval/revocation POSTs same-origin with CSRF/consent validation. No wildcard origins, no credentialed CORS, no authentication bypass. Responses expose OAuth challenge headers. CSP form-action remains self.

## Files
factory-cloud/src/factory-mcp.js; factory-mcp.test.js; docs/FACTORY_MCP.md.

## Tests
Real provider test runs the complete registration→authorization landing→same-origin consent→PKCE token exchange→MCP tools/list with a ChatGPT Origin. Negative tests cover null/malicious/lookalike origins, unknown preflight methods/headers, cross-origin approve/revoke, and cookie-only MCP denial. Full npm test: 858 passed, 0 failed; diff check passed. No publishing or paid generation.

## Next step
After deployment, user restarts Connect in ChatGPT from the MCP app page; stale consent pages should be closed. If their browser still fails, capture the exact failing request stage before changing any additional origin policy.

## Deployment evidence
Main 2910d4f deployed with npm run deploy from a clean synchronized main checkout. Worker version e8eba39d-6ed9-44b0-b8b2-ce1a0435e11c. Live ChatGPT-origin discovery and auth landing returned 200, MCP preflight 204, unauthenticated MCP 401 with exact-origin CORS. Evil origin and cross-origin consent POST remained 403. User must retry their actual ChatGPT connection to confirm browser completion.
