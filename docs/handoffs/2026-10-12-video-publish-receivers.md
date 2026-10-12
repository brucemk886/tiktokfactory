# Video publishing receiver mentions

## Goal
Add the existing @承接账号 option to Psychology manual video publishing, matching photo creation.

## Decisions
- The checkbox stays unchecked. It appears for ready Video Hits clips and generated video templates, and stays hidden on TikTok One selection.
- Each video independently draws a non-self saved receiver and freezes the receiver, CTA and settings revision. The CTA is appended only to the publishing caption. Saved source captions, scripts and titles stay unchanged. Captions over 2200 characters are rejected. Account-pool matching still rejects mentions.
- Task details show the assigned receiver and the final video description. Retries keep the frozen caption.

## Files changed
- scripts/psychology-auto-publish.js
- factory-cloud/src/psychology-auto-publish.js
- factory-cloud/src/psychology-photo-receivers.js
- public/psychology-auto-publish.html
- public/psychology-auto-publish.js
- Receiver, video-library and UI tests
- docs/CURRENT_STATE.md, docs/ARCHITECTURE.md

## Tests performed
- Focused receiver, video-library and auto-publish UI tests.
- Ready-library browser flow for the video creation checkbox.

## Unfinished work
TikTok One selected-video publishing does not offer this checkbox. Durable autopilot scheduling still has its own content-source path.

## Recommended next step
Open a normal video task, tick @承接账号, and confirm the task detail shows the assigned account and the appended caption.
