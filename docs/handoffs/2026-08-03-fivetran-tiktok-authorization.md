# Fivetran TikTok Authorization Handoff

## Goal

Add owner-authorized TikTok account connections to Local Factory through Fivetran Connect Card without replacing the existing public-data analytics pipeline.

## Decisions

- The integration is admin-only in the first release.
- Fivetran credentials and account connection records are stored under the configured runtime work directory, not in Git.
- Connect Card URLs are returned to the active browser but are never persisted.
- New account connections reuse the exact service and reusable configuration of a selected existing TikTok Organic connection.
- Duplicate create clicks are guarded by an idempotency key.
- Disconnect pauses the Fivetran connection instead of deleting it.
- Local Factory currently controls authorization and sync. Reading synchronized rows into Data Overview requires a destination database connection in a later step.

## Files Changed

- `scripts/fivetran-tiktok.js`
- `scripts/fivetran-tiktok.test.js`
- `scripts/server.js`
- `scripts/local-auth.js`
- `scripts/local-auth.test.js`
- `public/tiktok-connections.html`
- `public/tiktok-connections.css`
- `public/tiktok-connections.js`
- `public/access.js`
- `public/accounts.js`
- `package.json`
- `package-lock.json`

## Runtime Configuration

- Settings: `<workDir>/fivetran-settings.json`
- Integrations: `<workDir>/fivetran-tiktok-integrations.json`
- Events: `<workDir>/fivetran-tiktok-events.json`
- The discovered Group and existing TikTok Organic template connection are selected in runtime settings.

## Tests Performed

- `node --test scripts/local-auth.test.js scripts/fivetran-tiktok.test.js` (8 passed)
- JavaScript syntax checks for the server and new browser scripts.
- Read-only Fivetran discovery verified the configured Group and TikTok Organic service.
- Authenticated HTTP health check returned 200 for the page and overview API.
- Headless Chrome visual check at 1600x1000.

## Unfinished Work

- No new TikTok account has been authorized yet; an owner must complete the Connect Card flow.
- The destination reader is connected, but private metrics are currently previewed on the authorization page and are not yet aggregated into Data Overview.
- Webhook-driven status updates and data-health alerts are not implemented; the page currently polls status and supports manual refresh.

## Recommended Next Step

Authorize one test TikTok account, confirm the first Fivetran sync and destination tables, then add a read-only destination adapter and map the confirmed columns into Data Overview.

## Authorization Flow Update

- Fixed the Connect Card request body to send the required `connect_card_config` object.
- Removed the generic URL QR-code modal because it was not TikTok-native authorization and added unnecessary friction.
- Clicking `授权` now navigates directly to the Fivetran Connect Card in the current browser. Fivetran redirects back to `/tiktok-connections` after setup, where Local Factory refreshes the connection status.

## Destination Reader Update

- Added a PostgreSQL destination adapter in `scripts/fivetran-destination.js`.
- Database credentials are stored only at `<workDir>/fivetran-destination-settings.json` and are omitted from API responses and Git.
- All application reads run inside explicit read-only transactions with connection and statement timeouts.
- `/tiktok-connections` now supports saving/testing the destination, discovering synchronized TikTok schemas, and previewing profile, video, retention, traffic-source, and audience data.
- The confirmed destination currently contains one TikTok Organic schema with 13 business tables. Secrets and row-level customer data are intentionally not recorded in this handoff.
- Added focused tests in `scripts/fivetran-destination.test.js`; the Fivetran test suite passes.

## Next Mapping Step

Once more accounts finish authorization and create their schemas, aggregate the confirmed private metrics into Data Overview while keeping the current public-data pipeline as a separate source.

## Single Video Verification Page

- Added an admin-only page at `/tiktok-video-detail` with account/schema selection and video ID or caption filtering.
- The page reads one exact video directly from the Fivetran destination and exposes core metrics, retention, like timing, impression sources, gender, country, city, audience type, and synchronized comments.
- Database reads remain parameterized and run in read-only transactions. Video IDs must be numeric and schemas must come from discovered TikTok schemas.
- Added focused destination-adapter tests and verified the routes with the configured destination. No credentials or synchronized row data are stored in this handoff.
