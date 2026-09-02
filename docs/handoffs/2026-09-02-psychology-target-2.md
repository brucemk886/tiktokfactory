# Psychology Target 2 Interactive Quiz

Updated: 2026-09-02

## Goal

Use the four supplied psychology-test references to add a second psychology direction to the local mid-video factory, named "心理学 · 目标2".

## Decisions

- The four references are 12.43-18.65 second horizontal videos built around one persistent test image, a top hook, an animated stick companion, bottom Chinese-English captions and a comment CTA.
- Target 1 remains the 60-120 second 4:3 paper-collage narrative at /psychology-collage.
- Target 2 is available at /psychology-target-2; the earlier /psychology-narrative URL remains as a compatibility alias.
- Target 2 supports hidden-number, position-choice, character-choice and embrace-choice modes, plus automatic selection.
- New Target 2 jobs default to English public copy and English narration. English uses a selected local Kokoro English voice. If the final narration contains any Chinese characters, the worker routes the whole narration to the configured ElevenLabs voice instead; provider selection is based on the parsed final narration rather than trusting the requested-language flag.
- Kie is used for one test image per output; the browser confirms the expected Kie image-call count and whether narration will use local Kokoro or bill ElevenLabs before starting.
- Hidden-number and position assets use 4:3 generation; character and embrace assets use 16:9. A-F marks are allowed only for position tests; A-D labels for row choices are added in Remotion.
- Clinical-looking claims such as diagnosing depression severity are blocked by the score gate and must be rewritten as non-diagnostic self-observation.
- The first formal sample uses the position-choice format, Kie nano-banana for the persistent test image and local Kokoro `zf_xiaoxiao` for Mandarin narration. Kokoro's Chinese text-processing extras and the Xiaoxiao voice are installed in the existing local runtime.
- The right-side companion uses eight independent local SVG assets. Each caption sentence maps to one SVG; the SVG alternates slide-in direction at sentence start, remains stable during that sentence, then slides and fades out before the next sentence. All assets preload at frame zero to prevent dynamic-load stalls. This does not add video duration or external generation calls.
- Narration, captions and SVG actions share measured sentence timing without repeatedly starting the voice model. English Kokoro renders the full narration once and maps returned word timestamps to sentences. Chinese ElevenLabs uses the official `with-timestamps` endpoint once and maps returned character timestamps to sentences. Character-weighted timing remains only as a fallback if a provider returns no timing data and for old Remotion props.
- Re-running the same job now clears stale error and result fields before production, so a recovered job cannot remain visually marked with its earlier failure.

## Files changed

- public/mid-video.html
- public/psychology-narrative.html, public/psychology-narrative.css, public/psychology-narrative.js
- public/psychology-poses/stick-01.svg through stick-08.svg
- scripts/psychology-narrative.js, scripts/psychology-narrative-job.js, scripts/psychology-narrative.test.js, scripts/kokoro-tts.js
- scripts/psychology-collage.test.js
- scripts/server.js
- remotion/psychology-landscape.jsx, remotion/root.jsx
- jobs/psychology-target-2/manifest.json
- docs/CURRENT_STATE.md

## Tests performed

- Psychology content fixture scored 100/100 with no diagnostic risk.
- node --test scripts/psychology-narrative.test.js scripts/psychology-collage.test.js passed after target naming updates.
- A 16.04-second offline Remotion preview rendered at 1920x1080 and 30 fps with H.264 video and AAC audio.
- First visual review found lower position labels near the image edge; the single revision reduced compact test assets to 92% of their safe area.
- The second render passed a five-frame visual review, ffprobe stream checks and full FFmpeg decode.
- The formal 15.51-second sample rendered at 1920x1080 and 30 fps with H.264 video and AAC audio, using one Kie nano-banana image and local Kokoro narration.
- Independent audio QA measured -20.2 dB mean and -4.9 dB peak; the final output is audible. The five-frame contact sheet, ffprobe and full FFmpeg decode all passed.
- Formal output: `D:/localfactory-data/outputs/心理学-目标2-你下意识选择的站位，暴露了你内心的防备指数-1-20260902084651-206c.mp4`.
- The one-second SVG replacement comparison rendered to `D:/localfactory-data/outputs/心理学-目标2-每秒切换SVG火柴人-20260902.mp4`. A 16-cell per-second contact sheet confirmed the eight-pose loop, and ffprobe, full decode and audio QA passed without new external credits.
- The final sentence-mapped SVG sample rendered to `D:/localfactory-data/outputs/心理学-目标2-一句一SVG滑入滑出-20260902.mp4`. The first render timed out while dynamically mounting the second SVG; the single retry preloaded all eight assets and passed. A half-second contact sheet confirmed three stable sentence-to-SVG mappings plus visible slide/fade exits and entrances. ffprobe, full decode and audio QA passed without new external credits.
- The final synced sample rendered to `D:/localfactory-data/outputs/心理学-目标2-字幕音频同步校正版-v2-20260902.mp4`. Four Kokoro sentence segments produced measured boundaries at 5.596, 7.902 and 13.271 seconds. Each boundary fell inside an actual sentence pause, and the caption/SVG boundary contact sheet passed. Final duration is 15.488 seconds; audio QA measured -19.3 dB mean and -4.4 dB peak; ffprobe and full decode passed. No new Kie or external voice credits were used.
- English/Chinese routing regression: `node --test scripts/psychology-narrative.test.js scripts/psychology-collage.test.js scripts/kokoro-voices.test.js scripts/sidebar-modules.test.js scripts/local-auth.test.js` passed 36/36. The suite covers English default prompts and scoring, exact English sentence captions, Chinese detection, ElevenLabs routing, the one-shot timestamp endpoint and removal of segmented model starts.
- Local English Kokoro smoke test used one `am_adam` invocation, completed in about 9 seconds, produced 8.525 seconds of audio and returned 23 word timings. No Kie or ElevenLabs request was made.

## Unfinished work

- Publishing behavior was not changed, and the formal sample has not been published.
- The Chinese ElevenLabs branch was validated structurally against the official timestamp API and by tests, but was not called during QA to avoid consuming the user's ElevenLabs quota.

## Recommended next step

Review the formal position-choice sample in the local factory. If its content direction is approved, generate the remaining hidden-number, character-choice and embrace-choice samples before selecting anything for publishing.
