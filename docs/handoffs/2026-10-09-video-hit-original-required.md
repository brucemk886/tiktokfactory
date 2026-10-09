# Browser recreation import: required original material and paired copy

## Goal
Require original title, caption and images in the browser import workflow; store each original image with its corresponding copy and make that structure visible.

## Decisions
- Original title/caption and 1–15 original images are mandatory for new sources; every original image needs nonblank corresponding copy. Recreation title, caption and 1–15 images are mandatory. Optional source transcript/narration remain separate from per-image copy.
- Original uploads and paired text are visible in the source section, no longer hidden under optional fields. Each image/text card moves or removes as one unit. Missing original files have browser custom validity; required text fields and model validation reject missing/whitespace values before writes.
- Selecting an existing source reads all original-frame pages, verifies contiguous images and per-image copy, and shows stored original caption plus paired previews. Incomplete originals fail before uploading recreation assets; an edit link opens the source. Retrying after supplementation rereads source data.
- Final completion reads back source title/caption and original image references/order/text as well as the existing recreation checks. Mismatches remain visible failures; the same session can retry without duplicate mutations.
- Original import protocol remains staged source/frame/version writes using existing session APIs. No backend contract/schema change; active REST/MCP writers remain compatible. No publishing behavior changes.

## Files changed
- public/psychology-video-hit-import.html, .css, .js, -model.js.
- scripts/psychology-video-hit-import.test.js.
- docs/psychology-video-hits-api.md and generated public guide; generated UI asset manifest.
- docs/CURRENT_STATE.md and this handoff.

## Tests performed
- 10 import model/database/Chromium workflow tests passed.
- 49 existing API, member permissions and asset-manifest tests passed.
- Missing title/caption/images/per-image text, whitespace, frame-index gaps, missing originals on later pages, corrected-source retry, mismatched original readback, committed response loss and upload retry covered. No render or publish jobs created.
- Chromium covers required-field rejection, original image/text reorder and removal, stored original caption and ordered copy, recreation save/retry, and an additional version using the existing original preview.
- Desktop 1440px and mobile 390px/320px screenshots captured; no horizontal overflow. Desktop/mobile layout visually checked. Generated manifest and git diff --check passed.

## Unfinished work
Deployment and production read-only verification pending at commit time.

## Recommended next step
Deploy from clean GitHub main with npm run deploy, verify served assets, then import a real image-text set through the logged-in browser.
