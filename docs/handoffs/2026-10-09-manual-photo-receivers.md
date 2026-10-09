# Manual photo receiving-account mentions

## Goal
Add an optional @承接账号 checkbox to Psychology automatic publishing → photo creation. Each post randomly chooses a saved receiving account and appends the saved CTA.

## Decisions
- Unchecked by default. Covers selected Video Hits albums and generated photo sources. Reads the current acting owner’s saved receiver/CTA configuration even if automatic operations are disabled.
- Independently choose per post, excluding the publishing account itself; different posts may legitimately pick the same receiver. Empty/self-only pools block the entire request with a clear explanation. Receivers must remain authorized in Psychology, have a valid unchanged handle, synchronized >=1000 followers and confirmed homepage link.
- Freeze receiver/CTA/revision when creating each task. Append only to the publishing caption; preserve source copy and image/page content. Reject captions over 2200 characters. Settings revision races roll back the batch; duplicate request replay and render/submission retries retain the assignment. Execution checks current receiver access and fails explicitly instead of rerouting.
- Show saved pool and CTA example before creation; show actual assigned @ and available final caption in task details. Existing automatic imported-photo stable routing is unchanged. No settings, active jobs or existing captions are rewritten.

## Files changed
- factory-cloud/src/psychology-photo-receivers.js and dedicated tests.
- scripts/psychology-auto-publish.js normalization; factory-cloud/src/psychology-auto-publish.js and psychology-video-hit-photos.js integration.
- public/psychology-auto-publish.html/js and new public/psychology-photo-receivers.js.
- Video Hits photo transport and browser regression tests; package test command, UI asset manifest, CURRENT_STATE and ARCHITECTURE.

## Tests performed
- Ten focused receiver tests cover opt-in typing/compatibility, owner and grant isolation, receiver eligibility, non-self random choices, immutable per-item copies/replay, settings races, access revocation and generated-photo handoff.
- Sixteen selected-photo tests pass, including a mocked official Hub request proving exact final CTA and once-only group replay. No real publication API was called.
- Browser flow passes at 1440, 390 and 320px: default unchecked, receiver/CTA read, checked request flag, self-only block, uncheck recovery, and unchanged video/One paths. Screenshots inspected. Test now waits for enabled account-selection controls before clicking, fixing an existing load race.
- Updated the existing VM UI harness to load the real receiver component; all 29 UI unit tests pass, including generated-photo opt-in, video isolation and escaped task-detail captions.
- Full declared regression suite: 1,491 passed, zero failed (four concurrent test files). UI manifest and git diff whitespace checks pass. Production verification completed below.

## Unfinished work
None. A real test post remains an explicit user action through the normal publishing form.

## Recommended next step
After release, refresh Psychology automatic publishing, choose photo, select content/accounts and tick @承接账号. Use saved receiving configuration; task details show the chosen recipient and caption.

## Release evidence
Runtime commit 63eb740c90cceb0b8ae5e963924b896fdc16a405 was committed and pushed to GitHub main before deployment. Clean checkout and exact HEAD == origin/main passed; npm run deploy completed (Worker ede28b9e-cd0a-435c-92f9-fcc07b2a8119). Production receiver module and publishing script returned HTTP 200 with exact normalized SHA-256 matches to committed files. Anonymous receiver API returned 401. No real post, receiver setting, existing task modification or job interruption was used for verification.
