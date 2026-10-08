# TikTok-only independent-site conversion reporting

## Goal
Show only recorded TikTok traffic, quiz conversions and orders in Psychology's independent-site dashboard, as requested on 2026-10-08.

## Decisions
- Filter at the read-only SQL projection, before aggregations and pagination. Normalize TikTok labels and TikTok hostnames; prefer nonempty quiz_attribution.source over legacy quiz_sessions.source. Never infer a channel from factory campaign identifiers alone.
- Exclude direct, other and unknown channels. TikTok sessions without a current project account campaign remain in channel totals and are labeled as account-unassigned.
- Apply the filter consistently to start-cohort conversions, payment-date base/deep orders, currency totals, daily rows, sources and account summaries. Preserve existing permissions, test exclusions, date rules and refunded-order accounting.
- Anonymous traffic_anonymous_pages rows have no source field. Remove all-site PV from the dashboard and return null for API pageviews; never substitute arrivals or fabricated zeros.
- Keep the existing TikTok promotion-short-link funnel and profile metrics. Match quiz conversions with the same normalized source rule. Tagged links forwarded elsewhere remain attributed to TikTok; disclose that limitation.
- API response version is 2 with channel=tiktok. No channel=all override. No database migration, attribution backfill, link creation, payment or publishing mutation.

## Files changed
- factory-cloud/src/psychology-website-data.js and psychology-website-funnel.js
- public/psychology-website.html, .js, .css and the generated UI asset manifest
- factory-cloud/src/psychology-website.test.js, psychology-website-funnel.test.js and scripts/psychology-website-ui.test.js
- factory-cloud/src/factory-api-catalog.js, docs/FACTORY_API.md and docs/CURRENT_STATE.md

## Tests performed
- 51 focused checks passed across analytics/funnel/links, browser UI, unified API authorization, static asset caching/manifest and authenticated first-paint suites. The browser suite was rerun successfully after fixing its newly added element-count selector.
- Mixed-channel real SQLite fixtures verify direct/unknown/Google/lookalike sources and conflicting legacy metadata cannot affect totals, revenue, pagination or API responses. Covered empty-attribution fallback, account-unassigned TikTok, deep orders and orphan orders.
- Headless Chrome covered 1366/390/320 widths, four tabs, pagination, unsafe text escaping, failed/stale reads and absence of all-site PV. Desktop/mobile screenshots inspected.
- git diff --check passed. No tests called GeeLark publishing APIs.
- Read-only source inspection confirmed anonymous PV cannot be segmented retrospectively and recent recorded sessions were direct, not identifiable TikTok. Source records were not changed.

## Unfinished work
No implementation work remains. Production release and live read verification follow the repository's clean main / exact origin/main deployment gate; evidence is retained in this task's tool output.

## Recommended next step
Use each receiver's existing TikTok promotion short URL in its bio to attribute future visits, tests and orders. Historical untagged direct traffic cannot be reliably reassigned.
