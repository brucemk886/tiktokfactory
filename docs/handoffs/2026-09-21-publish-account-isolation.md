# Goal
Prevent one unavailable TikTok account from aborting an entire psychology publication group.

# Decisions
- Keep stable group external IDs, task references and the existing 20-item factory group size.
- Hub batch creation still validates identities, customer ownership and assets, but upstream account settings and account-specific visibility/comment checks run in the durable per-task preparation queue for both photo and video.
- Known permanent authorization failures stop only their task; temporary failures keep existing bounded queue retries. No actual publish API is called during preparation.
- TikTok HTTP 200 business failures become error HTTP statuses (401 for revoked-token code 40105); original upstream status remains available for existing safe retry classification. Generic HTTP error responses cannot emit success codes.
- Factory rejects HTTP 200 error envelopes and removes stale local submit errors once a receipt exists.

# Files changed
Hub: lib/hub-publishing.ts, lib/tiktok-publish-prepare-queue.ts, lib/tiktok-auth.ts, lib/http.ts, lib/customer-presentation.ts, tests/publish-account-isolation.test.mjs, package.json.
Factory: src/signal-desk.js, src/signal-desk.test.js, src/psychology-auto-publish.js, src/psychology-auto-publish.test.js, package.json, architecture/current state docs.

# Validation
- Hub build, 239 tests, TypeScript check.
- Factory 507 tests.
- Real SQLite/Drizzle regressions: 1 revoked + 19 healthy for photo/video, stable replay, transient retry isolation, inactive account isolation, visibility isolation, foreign/unknown account rejection. No real publishing endpoints in tests.

# Unfinished / next step
Deploy committed main revisions for both services; recover the existing failed group with its original external ID and verify individual task results. Production recovery results are reported in the task response; no account/customer data is included here.
