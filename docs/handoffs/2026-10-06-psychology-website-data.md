# Psychology independent-site traffic and orders

## Goal
Connect DeepPersona admin traffic and orders to the psychology backend before changing ongoing content operations.

## Decisions
- Add a live, SELECT-only DeepPersona D1 binding and /psychology-website, linked from automatic operations and data overview. No source-site deployment, schema writes, new tracking identifiers, credential copying or publishing changes.
- Reuse current conversion permissions and campaign-owner checks; only current authorized accounts resolve factory campaign links. Export operating data without customer emails, answers, report snapshots or private access links.
- Match site quiz-start-cohort exclusions. Count payment-date live base/deep orders separately, retaining subsequently refunded sales, currency separation and explicit gross-vs-payout semantics.
- Provide stable bio links for current thousand-follower candidates. Links do not claim profile setup or confirm receiver readiness. Untagged historical visits and upstream videos behind shared bio links remain unattributed.
- Add unified API psychology/website.read for future automation. Data reads and user-visible auto-refresh cannot enqueue or publish work.

## Files changed
New website query/handler/tests; public dashboard HTML/CSS/JS and browser tests; factory routes/API catalog and static manifest; extra D1 binding; docs.

## Tests performed
Focused SQLite/backend tests: 9 passed (date boundaries, real SQL aggregation, exclusions, refunds/currencies, pagination, unknowns, privacy, permissions, unified API).
Browser checks: desktop 1366 and mobile 390/320, all four tabs, contained tables, safe source text, links, pagination, stale reads and failed reads passed.
Full factory regression: 1,239 passed, zero failures or skips. Shared first-paint theme rules and mobile layouts pass. Read-only production SQL validation completed with zero rows written; deployment verification follows.

## Unfinished work
Production release verification. Receiver links still require the owner to set them on actual profiles and confirm the receiver configuration; this integration does not fabricate that confirmation. Broader 360-account enrollment and content strategy changes remain separate from this data-connection request.

## Recommended next step
Use the new page to compare live site totals and tagged receiver conversion, then confirm receiver profile links and plan conversion-focused content using real outcomes.
