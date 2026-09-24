# Admin console redesign (option 3)

## Goal
Apply the selected Product Design direction to the online factory: navy sidebar, light workspace, clearer controls and Bootstrap-like interaction.

## Decisions
- Shared admin-ui.css/js are loaded through access.js. Keep existing API routes, permissions and publishing mechanics.
- Psychology automatic publishing becomes table-first with status counts, current-page search/media filters, bottom pagination, creation modal and right detail drawer.
- Keep account selection, 1–100 count, 20-item hub groups, idempotency, retry and failed-item deletion. State now says submitted rather than claiming TikTok completion.
- Use locally vendored Bootstrap Icons 1.13.1 (MIT). No framework migration, external CDN or database migration.
- Skip unchanged polling DOM replacement. Native dialogs and responsive navigation include focus, Escape and hidden/inert handling.

## Files changed
public/access.js; public/admin-ui.css/js; public/vendor/bootstrap-icons/*; public/psychology-auto-publish.html/css/js; scripts/psychology-auto-publish-ui.test.js; design-qa.md; docs/CURRENT_STATE.md.

## Tests performed
- Final factory-cloud npm test: 613/613 pass. Focused publish UI: 18/18, including account handles, group selection, sources, failed deletion, filters/modals and unchanged polling.
- JS syntax and git diff --check.
- Isolated browser preview at 127.0.0.1:4173; one mock photo submission with 20 accounts / 60 posts. Exact request checked. No live publishing/comment endpoints invoked.
- Desktop 1440px and mobile 390px; selected design and drawer compared in the same input. Shared copy library, TikTok accounts, psychology overview, comments, novel library and home checked. Evidence paths in design-qa.md.

## Release
Deployed through factory-cloud npm run deploy after clean exact origin/main validation. Read-only live verification confirmed 7 real publishing batches, opening batch details, and 382 photo originals with correct 20-page pagination. Real-data review led to explicit copy-table column widths and fixed desktop actions, verified with a long-copy synthetic fixture at 1440px and 1100px before the follow-up release. No production task was created, cancelled, deleted or retried.

## Unfinished / recommended next step
No known implementation blocker. Specialized editors retain their existing composition and workflow. Collect user feedback on task density and the list/detail interaction; no backend load-testing or scheduling change is included.
