# Goal
Pause fixed account styles and randomly draw photo styles to compare performance.

# Decisions
- New photo submissions default to random, one independent uniform draw among twenty active styles per post. Small batches may contain repeats; no balanced-block guarantee.
- Older pages sending group are normalized to random for new batches. Explicit fixed and legacy choices remain. Existing batch replay returns its saved tasks; old assigned styles are not recalculated.
- Random results are frozen in psychologyAutomation.styleId and psychology_creative_snapshots at creation; all pages of one post, rerenders and retries use the same recorded style.
- Remove the account binding form/primary-style table and use random-test guidance plus an effects link. The old binding API/data remain for compatibility but batch creation no longer reads them.
- Read-only production inspection for the signed-in administrator found zero manually saved scoped bindings; previous fixed styles came from default account hashing. No account settings needed deletion and no running jobs were modified.

# Files
public/psychology-visual-styles.js, psychology-auto-publish.html, psychology-creative.html/js; scripts/psychology-auto-publish.js and UI tests; factory-cloud/src/psychology-auto-publish.js and psychology-creative.test.js; current-state, architecture and photo-creative docs.

# Tests
553 full factory tests passed. Focused tests cover all twenty random outcomes for the same account despite explicit bindings, imported workflow/render propagation, duplicate submission without redraw, historical group-batch replay, photo defaults, fixed/legacy/video compatibility and UI links. No real posts or generation tasks were created.

# Deployment / next step
Commit and push main, then standard factory-cloud npm run deploy and hosted page smoke checks. Review future published works in psychology operations content/style comparison after data ingestion; existing pre-change jobs keep their original styles.
