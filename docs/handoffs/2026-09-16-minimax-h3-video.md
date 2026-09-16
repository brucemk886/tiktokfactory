# MiniMax H3 in AI video creation

## Goal
Add Kie MiniMax H3 to the factory AI creation video page with a model selector.

## Decisions
- Text-to-video first: `minimax-h3/text-to-video` via the existing Kie createTask and recordInfo endpoints and server-only KIE_API_KEY.
- Keep Grok as the backward-compatible default. Model-specific controls reset incompatible settings when switching.
- MiniMax validates 4–15 integer seconds, 768P/2K, supported aspect ratios, and a 7000-character prompt limit before a paid request.
- Shared request builder serves cloud and local paths. Existing image/analysis and recreation workflows are unchanged.
- Creation history stores and labels the actual model, and retains video preview/download links.

## Files changed
- scripts/kie-video-models.js and tests
- scripts/kie-ai.js and tests
- factory-cloud/src/kie.js, ai.js and ai.test.js
- factory-cloud/package.json
- public/ai.html and public/ai.js
- docs/CURRENT_STATE.md

## Tests performed
- Full factory suite: 326 passed, zero failed/skipped.
- Covers exact MiniMax request payload, numeric duration, unsupported model/settings rejection before billing, persistence, polling, result URL, credits, terminal-state polling, and existing Grok defaults.
- git diff --check passed.

## Production verification
- Code commit `a481ffb` pushed to GitHub main; deployed using `npm run deploy` from the clean release checkout matching origin/main.
- Production version: `152abe4f-e9a9-4f15-9705-56d038e5c372`.
- Authenticated browser verification on `/ai`: MiniMax selector works, 4 seconds/2K are selectable, switching back to Grok resets incompatible settings to 6 seconds/480p.
- Submitted exactly one test through the live AI video form: MiniMax H3, 4 seconds, 768P, 9:16; orange cat beside a window, prompt prefixed `MiniMax H3 integration check`.
- The task completed; history displayed MiniMax H3, completed state, video player, open/download links and 32 returned Kie credits.
- ffprobe read the generated remote file successfully: H.264 video at 768x1344, AAC audio, duration 4.458333 seconds.
- Browser media playback did not finish loading within the bounded check in the automation window. The returned file itself was verified via ffprobe; no claim of browser playback verification.
- Browser automation session closed. No other user jobs or publishing calls were made.

## Unfinished work
No remaining integration or deployment changes. Optional: check in-browser playback under the user's normal browser/network if the player takes time to load.

## Recommended next step
Open AI creation → AI video → MiniMax H3 and enter a prompt. Existing Grok remains selectable. No new API key is required.
