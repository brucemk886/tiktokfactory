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
18 focused factory/backend/browser tests passed; full Factory regression 1,252 passed with zero failures/skips.
DeepPersona TypeScript validation, production build and 82 tests passed. Desktop 1366 and mobile 390/320 layouts and receiver filtering checked; mobile screenshot inspected.

## Unfinished work
Accurate per-person linkage from TikTok profile visit to external click is unavailable. Missing official daily samples, opt-outs, blocked scripts and copied destination URLs can limit completeness. History before click-cohort activation remains unknown.

## Recommended next step
Deploy the site and factory changes through their prescribed clean-main workflows, initialize through a marked verification-bot short-link request, then verify visible-page arrival and exclusion from customer funnel totals.
