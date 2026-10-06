# Psychology profile-to-payment funnel

## Goal
Show profile visits, short-link clicks, successful arrivals and subsequent testing/payment drop-off by receiving account.

## Decisions
- Keep the existing short URLs. Site-side per-click records and browser confirmation fill the missing arrival stage; existing quiz_attribution.visit_id links later sessions without changing payment fulfillment.
- Aggregate the same click cohort, counting each token once per stage even if it starts several tests or places several orders. Later payments remain in the original click cohort. Bot/prefetch exclusions and source test exclusions remain explicit.
- Scope the new comparison to current authorized receiver candidates/links. TikTok supplies daily profile visits, not exposure impressions or individual identity; only complete synchronized coverage allows an aggregate reference click rate.
- Align the new funnel to UTC days, including relative today/yesterday filters. Existing Beijing historical summaries and gross order totals stay separately labeled.
- Show unavailable/historical metrics as unknown. No historical arrivals are fabricated, and no TikTok click metric is claimed.
- Do not set profile URLs or receiver readiness, publish content, change queues, or process a payment.

## Files changed
Factory funnel query/tests, website handler/data projection export, leading dashboard HTML/JS/CSS, browser tests, manifest and docs.
DeepPersona short-link adapter, link-traffic table/arrival handler, visible-page confirmation, quiz source token propagation and tests.

## Tests performed
18 focused factory/backend/browser tests passed; full Factory regression 1,252 passed before integration and 1,254 passed after preserving concurrent main changes, with zero failures/skips.
DeepPersona TypeScript validation, production build and 82 tests passed. Desktop 1366 and mobile 390/320 layouts and receiver filtering checked; mobile screenshot inspected.

## Unfinished work
Accurate per-person linkage from TikTok profile visit to external click is unavailable. Missing official daily samples, opt-outs, blocked scripts and copied destination URLs can limit completeness. History before click-cohort activation remains unknown.

## Recommended next step
Use each receiving account's branded short URL in its profile and review incoming click cohorts after traffic arrives. Profile setup and receiver-readiness changes were outside this implementation.


## Production verification (2026-10-06)
- Site runtime commit: fce233eaa09b83211ca99042c1ba6a7652d8e78c; Worker version: e6141aeb-ae6c-4c6a-a23e-8f8e01b0a18c.
- Factory runtime commit: c51aad6; Worker version: 2922fa05-1e6d-47b0-84db-6129c353f98d.
- Both runtimes were committed and pushed to main first, then deployed through their prescribed npm workflows with clean exact-main checks. Concurrent account-profile-link changes were preserved.
- Marked verification bot followed one existing short link. The destination retained account attribution and a valid click token; the browser arrival endpoint returned 204. Read-only source verification confirmed one click record, one arrival, and excluded=1.
- Live authenticated factory page displayed all six stages, loss counts/rates, tracking activation time, and partial profile coverage. Selecting one receiver updated the funnel and account scope correctly at a 390px mobile viewport.
- Tracking activated at 2026-10-06 09:35:55 UTC. Missing historic tracking is explicitly described; the marked verification traffic was absent from production funnel counts.
- Browser agent session closed. No publishing jobs, queues, profile URLs, receiver readiness, quiz content, or payment fulfillment were changed.
