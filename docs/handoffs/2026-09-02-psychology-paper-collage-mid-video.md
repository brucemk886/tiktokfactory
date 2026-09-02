# Psychology Paper-Collage Mid-Video Template

Updated: 2026-09-02

## Goal

Reproduce the supplied 89.5-second psychology/philosophy reference format inside the local mid-video factory and expose it under the requested name "心理学".

## Decisions

- The reference is a long-form 4:3 narrative: 1440×1080, 30fps, 8–12 symbolic scenes, paper/cutout collage art, Chinese yellow captions, English white captions, slow drift/zoom, and a closing interaction prompt.
- /psychology-collage owns this workflow and is the "心理学" card. The concurrently added 12–20 second single-image implementation remains /psychology-narrative and is labeled "心理测试".
- The workflow reuses local Kie.ai and ElevenLabs settings but asks for confirmation before paid generation.
- Content must score at least 85/100 before TTS or image generation. Content revision is capped at two and render retry at one.
- Runtime success requires a five-frame contact sheet, ffprobe validation, and a full FFmpeg decode.

## Files changed

- public/mid-video.html
- public/psychology-collage.html, public/psychology-collage.css, public/psychology-collage.js
- scripts/psychology-collage-core.js, scripts/psychology-collage-job.js, scripts/psychology-collage.test.js
- remotion/psychology-narrative.jsx, remotion/root.jsx
- scripts/server.js
- jobs/psychology-paper-collage/manifest.json
- docs/CURRENT_STATE.md

## Tests performed

- node --test scripts/psychology-collage.test.js scripts/psychology-narrative.test.js — 10/10 passed.
- Syntax checks passed for the collage core, collage job, collage browser script, short psychology job, and server.
- A 12.05-second offline Remotion preview was rendered from five reference frames without paid API calls.
- The first preview exposed a dynamic image-source timeout. Scene images were changed to preload at composition start; the single permitted rerender passed.
- Preview verified as H.264 1440×1080 at 30fps with AAC audio. ffprobe and full FFmpeg decode passed.

## Unfinished work

- No paid Kie.ai or ElevenLabs production run was started. The operator must initiate the first full artifact after reviewing the estimated calls.
- Publishing was not changed; generated MP4s remain local outputs for review.

## Recommended next step

Open /psychology-collage, confirm the Voice ID and image model, keep 90 seconds and 10 scenes for the first run, then review the five-frame contact sheet before publishing.
