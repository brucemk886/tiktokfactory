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
Receiver links still require the owner to set them on actual profiles and confirm the receiver configuration; this integration does not fabricate that confirmation. Broader 360-account enrollment and content strategy changes remain separate from this data-connection request.

## Recommended next step
Use the new page to compare live site totals and tagged receiver conversion, then confirm receiver profile links and plan conversion-focused content using real outcomes.

## Production verification
- Runtime commit 7a57201 was pushed to GitHub main before deployment. An independent clean main release checkout passed exact HEAD == origin/main and asset-manifest verification; npm run deploy applied no migrations and released Worker 89b714cd-25ee-4a75-ac94-56a718ff1e38.
- Logged-in production /psychology-website loaded successfully on a 390x844 viewport and returned real site data. The 30-day range (September 7–October 6, Beijing time) matched the source SELECT probe: 104 pageviews, 51 started sessions, 19 finished, 18 email submissions, 5 checkout sessions and 0 qualifying paid orders. These are operational aggregates, not customer records.
- The live promotion-links panel displays real eligible-account URLs and accurately reports zero confirmed receivers. No profile link or receiver-readiness setting was changed.
- Existing original-checkout edits/untracked files were preserved. Implementation lives in the attached psychology-website-conversions worktree; the independent release clone is under the original checkout's ignored work/ directory.

## Sidebar follow-up
- User requested a direct psychology sidebar entry. Add 独立站转化 immediately below 数据概览, reusing the existing page and access rules.
- Existing saved admin navigation gains the entry automatically; operators remain excluded. Changed cloud sidebar/auth and the existing website UI test.
- Full factory regression: 1,240 passed with no failures or skips, including stored admin grants and browser-rendered sidebar ordering.
- Ship through the clean main release checkout; final live verification is recorded in the task response.
