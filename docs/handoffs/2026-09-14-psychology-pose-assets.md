# Fix psychology render pose assets

## Goal and cause
Interactive psychology renders failed on `psychology-poses/stick-01.svg` through `stick-08.svg`. Both landscape rendering callers override Remotion's public directory with a per-job directory containing only generated audio and image files. The composition's eight built-in SVG companions were therefore unavailable.

## Changes
- Added `scripts/psychology-render-assets.js` to validate and stage the eight required SVG files without copying unrelated public assets.
- Both `psychology-narrative-job.js` and the landscape path in `psychology-video-job.js` use this helper.
- Added a filesystem test covering all eight real assets, preservation of generated media, isolation, and an actionable missing-source error.

## Verification and recovery
- The focused asset test and all 279 existing cloud tests passed. The failed interactive task was rendered from its cached image, narration and caption timings in 28.983 seconds. The 14.72-second, 1920×1080, 30 fps H.264/AAC output passed stream checks and full decoding. All five contact-sheet frames displayed the SVG companion correctly.
- Recovery uses no image/TTS provider calls and does not publish anything. Keep recovery scripts, job records and generated media outside Git.

## Release
Commit and push the fix to main, then fast-forward the local worker checkout. These child scripts are loaded afresh for each render; a parent worker restart is unnecessary. No cloud code or public asset change requires a cloud deployment.
