# Customer publishing API implementation — 2026-09-07

Goal: Let customers integrate video publishing using their own API keys, separate from the factory's internal administrative key.

Desk implementation committed and pushed: 76548f7 on codex/customer-publish-api. Worktree: D:/cursor/localfactory/work/customer-publish-api. Full decisions/tests/release notes: its docs/handoffs/2026-09-07-customer-publishing-api.md. User-facing documentation: public/customer-api-guide.md.

Capabilities: owner-scoped keys, key creation/revocation panel, account list, raw upload <=95 MiB, batch create/list/detail. Existing queues and owner quotas reused. No new payment/entitlement logic. No customer webhook, cancellation/retry endpoint or large-file direct upload in this first version.

Validation: 109 tests/build passed, TypeScript and targeted lint passed. Actual in-memory SQLite key lifecycle and batch isolation tests; no real publishing, production key creation or deployment. Normal-sized browser visual QA and a customer end-to-end publishing run remain unperformed.

Unfinished: Not merged/main or deployed. Main still has active data-deletion changes. Integrate independent branch when requested; preserve both dashboard changes, coordinate migration 0034, deploy through standard clean-main check. Do not advertise paid API entitlement until the user's pricing/subscription policy is implemented.

Next step: User can review API guide and request integration/deployment. Production still uses existing internal API only.
