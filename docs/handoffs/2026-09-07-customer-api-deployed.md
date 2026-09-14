# Customer publishing API deployed — 2026-09-07

Goal: Ship customer API and website key-management entry, as requested.

Release: Website GitHub main 8319dd8f7a58d4827d32476bb2cc3f6a1baeb9c7, Cloudflare version 40e5e889-3809-4951-9e81-179e81468470. Deployed from clean D:/cursor/tiktokaitool with HEAD == origin/main using npm run cloudflare:deploy (exit 0). Migration 0034_customer_api_keys.sql succeeded. Factory unchanged.

Decisions/files: Merged codex/customer-publish-api with latest e0f483f deletion release, preserved both suites and dashboard features. Customer API under /api/customer/v1; session key management /api/customer-keys; workspace sidebar API 接入; public/customer-api-guide.md. Owner-scoped keys/accounts/assets/batches; user quota reused. Added migration trigger permanently removing keys when user is deleted, protecting same-email re-registration.

Validation: Build + 120 tests pass; TypeScript noEmit and diff check pass. SQLite test includes key deletion/re-registration. Live health 200 ok true; guide 200 contains customer endpoint; unauthenticated keys/accounts/batches return 401. No actual customer video published as a test and no real key created. Browser visual QA not performed this release.

Unfinished: Stripe pricing/subscription entitlement integration remains unimplemented; API uses existing webpage quota. Customer callbacks, cancellation/retry and direct large upload not included. Next step: user can log in and open API 接入 to create their own key and follow the guide.
