# Psychology template topic banks

## Goal
Add an independent 目标题库 sidebar page for user-managed topics for video templates 01/02/03, and draw from the selected bank during psychology automatic publishing.

## Decisions
- /psychology-topic-bank is admin-only, separate from the workbench; all three banks start empty.
- /api/psychology-template-topics supports paginated search, revision-protected edits, soft delete, and atomic/idempotent CSV/JSON imports of up to 100 topics. Exact normalized title/content duplicates are skipped within each template.
- Topics contain title, optional content/category, priority 0–100, and enabled state. CSV template contains headers only.
- Video batches can use the matching template bank with random, priority, recent, or least-used selection; only-unused defaults on. Existing peer video/photo sources, copy-rewrite setting, and photo music pool remain available.
- Migration 0029 owns topics, import receipts, and usage. D1 usage triggers validate template/revision/enabled state, reject concurrent reuse when only-unused, and increment counts in the same batch transaction as job creation. Batch retries never consume twice. Counts mean allocated to a batch, including later failed/cancelled tasks; no automatic refunds.
- Job payloads freeze topicSource and content into script/answerGuide so later topic edits/deletes do not mutate queued jobs. Legacy configs normalize missing source/music fields on replay.

## Files changed
- factory-cloud/migrations/0029_psychology_template_topics.sql
- factory-cloud/src/psychology-topic-bank.js and scripts/psychology-topic-bank.js
- factory-cloud/src/{auth,index,pages,sidebar,psychology-auto-publish,psychology-auto-publish.test}.js
- public/psychology-topic-bank.{html,css,js}, public/psychology-topic-import.js
- public/psychology-auto-publish.{html,css,js}

## Tests performed
- factory-cloud npm test: 415/415 passed.
- SQLite tests: import replay/deduplication/all-or-nothing validation, permissions, template isolation, revisions, soft delete, selection order/category filters, immutable job content, shortages, legacy replay, concurrent draw rollback.
- Local headless Chrome with in-memory SQLite: sidebar, three empty banks, create/edit/disable, multiline CSV import, isolation, mobile overflow, source/rule switching, photo copy/music fields preserved. No production generation or publishing called.
- Desktop/mobile screenshots: ignored tmp/topic-bank-desktop.png and tmp/topic-bank-mobile.png.

## Unfinished work / next step
User supplies topics through the empty banks. Production deployment and read-only smoke verification are performed after this commit through factory-cloud npm run deploy.

## Deployment compatibility
The first remote migration was rejected by D1 with incomplete input. Replaced CASE/END trigger guards with SELECT RAISE(...) WHERE predicates to avoid the remote SQL splitter ambiguity (workers-sdk issue https://github.com/cloudflare/workers-sdk/issues/4727). Local transaction/concurrency tests were rerun after this change; no previous data is modified by migration 0029.
