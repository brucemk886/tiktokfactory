# Psychology module design preview — 2026-10-02

## Goal
Prepare image previews for all remaining active Psychology module pages before implementation. The user explicitly requested images first; no production UI changes or deployment are authorized in this phase.

## Decisions
- Extend the approved blue dashboard presentation from Automatic Operations, Operations Report and Data Overview, with layouts suited to each page's purpose.
- Cover twelve independent active pages and twenty-four page/operation states. Content lists emphasize filters and batch actions; creation tools group forms beside previews; publishing/comments separate progress, results and actionable states.
- Keep source management inside the canonical copy library. `/psychology-peer-hits` is an existing redirect, not another new page.
- Keep manual recreation as a historical state inside publication records. `/psychology-production` redirects to `?view=manual`; its new-task entry is already retired.
- `/psychology-topics` is a local legacy external-topic page absent from the hosted routes/sidebar. The active template topic bank is covered instead.
- All proposed previews use synthetic accounts, content and statistics. Existing scope, availability, missing values, metric definitions, source provenance and timezone distinctions remain visible. Current production captures are reference material only and are excluded from the delivery gallery.

## Files changed
- New handoff: `docs/handoffs/2026-10-02-psychology-module-design-preview.md`.
- Ignored preview artifacts: `tmp/psychology-module-design-20261002/`, including content (6 states), creation (10 states), operations (8 states), manifests, QA records, image gallery and three overview sheets.
- No changes to formal `public/`, backend, tests, package manifests or CURRENT_STATE.

## Validation
- Read active route/sidebar definitions, relevant handoffs, original page HTML/JS and the approved design references.
- Captured existing pages in a dedicated read-only browser session and closed that owned session. No live content generation, account mutation, publication, comments or queue controls were invoked.
- Rendered every state at desktop 1440px and mobile 390px. Per-group QA records check page width, missing images and script errors; fixtures use local data/assets and make no production requests.
- Creation previews reuse existing image assets and exact copies of repository card renderers, including all twenty active style pairs.
- Root and an independent reviewer inspected screenshots, checked synthetic statistics, clarified uploaded-content previews, and corrected date filters, time labels and mobile table hints. Final independent visual QA is PASS with no unresolved mandatory findings; final-design-qa.json records its limits.
- The local image gallery passes desktop/mobile layout, all twenty-four preview loads, zoom/close/Escape and zero script errors. Its read-only server listens at http://127.0.0.1:4288/; restart with node tmp/psychology-module-design-20261002/serve-gallery.mjs if needed.

## Unfinished work
Implementation is intentionally deferred pending the user's image review. The local image gallery is a design artifact, not a production build; it does not execute publishing or generation actions.

## Recommended next step
Use the image gallery and individual full-size/mobile images for feedback. After the user approves the design, implement the selected changes in the actual pages, preserve functionality/permissions/queue behavior and apply focused tests. Follow the repository's commit, push to main, exact clean HEAD check and standard npm deployment rules for that implementation phase.
