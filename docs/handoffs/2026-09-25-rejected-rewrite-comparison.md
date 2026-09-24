# Rejected rewrite side-by-side review

## Goal
Show pending/quality-rejected rewrite content next to its source, preserving manual approval.

## Decisions
- Pending 查看 and 通过 open the same source-left / rewrite-right review, with title, caption and page-order body cards. Video originals keep transcript and screen text visible next to rewritten body.
- This view is an immediate positional comparison, not a claim of semantic sentence matching. No translation/model calls are added. Missing pages are explicit; malformed output remains literal on the right. No original pages are silently discarded when a rewrite is shorter.
- Raw output is also available in a collapsed disclosure. The existing editable approval form is collapsed for structurally populated versions and expanded for malformed ones. Edits update the comparison preview. Existing approval API/guards unchanged.

## Files
public/psychology-copy-library.html, .js, .css; scripts/psychology-copy-library-ui.test.js.

## Validation
UI regression covers original/rewrite title/caption/pages, omitted pages, malformed raw output, video transcript, missing source, HTML escaping and preview edits without model calls. Full factory suite: 700 tests passed.

## Next step
Commit/push main, deploy with npm run deploy, verify a pending version read-only. Do not approve production content while testing.
