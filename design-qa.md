# Admin console design QA — 2026-09-24

final result: passed

## Source and evidence
- Selected visual truth: C:/Users/111/.codex/generated_images/01a0b30e-547a-7910-9360-62a9bdef342f/exec-4cd8d53b-b4ce-422e-bf40-c0867a7e0802.png (user selected option 3).
- Implementation: C:/Users/111/.codex/visualizations/2026/09/18/01a0b30e-547a-7910-9360-62a9bdef342f/factory-after-detail.png.
- Combined full-view comparison: C:/Users/111/.codex/visualizations/2026/09/18/01a0b30e-547a-7910-9360-62a9bdef342f/factory-design-comparison-final.png.
- Final focused comparison, with source and implementation in the same input: C:/Users/111/.codex/visualizations/2026/09/18/01a0b30e-547a-7910-9360-62a9bdef342f/factory-detail-comparison.png.
- Other evidence: factory-after-list.png, factory-after-create.png, factory-mobile-list.png, factory-mobile-create.png, factory-after-copy.png, factory-after-accounts.png, factory-after-overview.png, factory-after-comments.png, factory-after-novels.png in the same evidence directory.
- Desktop CSS viewport: 1440 x 1024, DPR 1. Source: 1487 x 1058 pixels, normalized to 1440px wide. Implementation full-page: 1440 x 1231; visible drawer: 460 x 1024. Full-page stitching includes below-viewport content; that extra height is not part of the drawer. Mobile CSS viewport: 390 x 844, DPR 1, measured document width 390, creation modal 374 x 812.
- State: authenticated admin; running photo batch with 20 accounts, 60 items, 40 submitted; local synthetic data. Additional queued, failed, submitted and empty-list states checked.

## Findings and iteration
1. [P2, fixed] Old mobile rules made the translated sidebar static and left a large blank area above the workspace. Fixed shared sidebar positioning; new mobile evidence begins with the page title directly beneath the 56px topbar. Document width equals viewport.
2. [P2, fixed] Old task-layout width/margins doubled workspace spacing and constrained the task area. Shared shell now has one 224px sidebar offset, 28px desktop padding, and a full-width main region.
3. [P2, fixed] Drawer lacked a clear metric hierarchy and generation progress could be confused with successful submission. Added three actual metrics and explicit generation label; submission counts and final-post status remain distinct.
4. [P2, fixed] Fifteen-second polling replaced unchanged DOM and interrupted interaction. Skip unchanged data renders; regressions cover both list and open drawer. Mobile navigation has inert hidden content, keyboard cycling and Escape return; dialogs use native modal focus handling and busy-close protection.
5. [P2, fixed] Legacy olive selection and low-contrast refresh-button styles remained on shared pages. Unified active controls to blue, corrected button colors and drawer text. Sticky dialog header and icon assets verified.

6. [P2, fixed after real-data check] Eleven equally sized copy columns cramped numeric metrics and dates. Added explicit 1610px table tracks, two-column action buttons and a sticky desktop action column. At 1100px, all four actions remain visible; only the table scrolls horizontally. Evidence: factory-copy-width-fix.png and factory-copy-actions-fix.png in the evidence directory. Full-page capture suppresses sticky positioning during stitching, so the action column was also verified with a normal viewport screenshot.

Post-fix full-view and focused comparison found no remaining P0/P1/P2 issue in the checked surfaces.

## Required fidelity surfaces
- Typography: Segoe UI / Microsoft YaHei fallbacks; 28px desktop title, 24px mobile, 18–19px section/detail titles, 13–14px controls and table text, 12px metadata. Source's exact generated typeface is unavailable; native Chinese font is intentional. Long task names truncate in the list and wrap fully in the drawer. Focused comparison verifies readable spacing and hierarchy.
- Layout: dark 224px navigation, 56px topbar, white surfaces, blue action emphasis, compact table and right detail drawer. Native modal drawer intentionally overlays the table rather than permanently reducing its usable width. Creation is a separate scrollable modal; current filters and draft values persist when it closes.
- Colors/tokens: navy #192b43, page #f5f7fb, surface white, blue #1265e6, restrained gray-blue borders. Status colors have text labels, focus outlines and disabled states.
- Images/assets: this is an operations UI without photographic illustration. Existing LF wordmark is retained. Navigation/actions use unmodified Bootstrap Icons 1.13.1 SVG assets with the MIT license; no decorative image substitutions.
- Copy/content: existing business labels retained. “已提交” explicitly means handed to the hub, not published on TikTok. Search is labelled “搜索本页” because it filters loaded batches only. The concept image's invented ETA/timeline is replaced by actual group state, schedule and retry data. No fake completion times or new backend metrics.

## Validation
- Browser: group g1 filters to 20 accounts, select-all yields 20, 60 photo posts divide to 3 per account and 3 hub groups. Mock-only POST preserves all 20 IDs, count=60, source=library, random style and schedule. No production publishing/comment APIs invoked.
- Drawer overview/detail tabs, arrow-key switching, Escape close, search/media filtering, creation draft preservation, native selection states and mobile menu checked.
- Shared layouts checked on copy library, TikTok accounts, psychology overview, comments, novel library and home. Production was verified read-only after deployment: 7 real batches load, detail drawer opens, and the photo copy library reports 382 items with page 1 / 20. Its document width is 1425px in a 1440px viewport.
- Full repository test command in factory-cloud: 613/613 tests pass after the added polling regression. Focused publish UI: 18/18. JS syntax and diff checks pass.
- Browser console messages observed during local QA were from installed Chrome extensions, not application script exceptions.

## Residual scope
- Common shell, tables, fields and dialogs apply across authenticated factory pages. Existing specialized editors retain their workflow and page-specific composition.
- Final production check is read-only; this is a UI change, not a production load test or a live publishing test.
