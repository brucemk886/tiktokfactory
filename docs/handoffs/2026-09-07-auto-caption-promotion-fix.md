# Automatic caption promotion fix

## Goal
Keep each novel video’s platform and search code in automatic publishing captions and remove peer-import filename suffixes.

## Decisions
- Resolve promotion code from the video snapshot first, then its matched novel/audio, then task fallback. Use a canonical platform/search-code CTA when structured identity is available.
- Keep promotion outside template choice and reserve its length before truncating the story text. Keep a story hook/title when available. Manual captions are unchanged.
- Remove the known trailing peer-hit marker, sequence and hash; retain meaningful title numbers.
- Fix generation and local official submission/record paths. No cloud code or previously submitted post is changed.

## Files changed
scripts/novel-video-badge.js, scripts/novel-video-badge.test.js, scripts/reddit-mix-job.js, scripts/server.js, scripts/auto-task-manager.js.

## Tests
42 focused caption, official publishing, worker and task-manager tests passed. Tested 100 template seeds, long text, identity precedence, filename cleanup and manual-caption preservation. Replayed the reported video metadata offline; its code is 479138. No publishing API called.

## Release
Prepared in isolated worktree from freshly fetched origin/main because the existing runtime workspace contains unrelated in-progress work. Commit and push this focused change before activation. Runtime restart must wait for idle; existing hosted batches are not rewritten.

## Next step
Verify new automatic submissions include the correct search code; existing TikTok posts require separate handling.
