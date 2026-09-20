# Goal
Move newly created psychology automatic photo posts from local Chrome to Cloudflare Browser Run, with two concurrent consumers and unchanged 20-item publication groups.

# Decisions
- Freeze cloudPhotoRender on each newly created source payload; old queued/running sources stay local. Verified in two default-off deployments, then enabled PSYCHOLOGY_CLOUD_PHOTO=true for new tasks.
- Cloudflare Queues uses one job/message, two consumers. D1 owns execution leases, retry availability and checkpoints; a dedicated minute watchdog dispatches missed messages and recovers expired cloud leases. Local claims exclude cloud-marked jobs.
- Shared card runtime preserves existing layout logic. Cloud Chromium uses the template font fallbacks (Georgia/Helvetica where Windows-specific faces are unavailable); verify exported images before activation.
- Download backgrounds before opening Chrome; cap buffered inputs. Render six pages in one browser call, close Chrome, back up each rendered image in private R2, then restore/upload through the existing photo checkpoint path. Group retry jobs inherit cloud ownership. No local worker restart.
- Two existing business retries, stable group externalId and frozen requests remain. Queue delivery retries do not reset business retry counts. No real TikTok/AI calls in tests or render probe.
- Worker-token-protected /api/worker/psychology-cloud-photo/probe accepts exactly six synthetic pages and only renders; it cannot publish.

# Files changed
Cloud renderer/queue/probe, shared public card runtime, automatic task creation/local claim/group retries, Wrangler bindings and migration 0035, focused tests and benchmark script.

# Tests performed
- Full suite 481/481 passing including integrated upload/submission tests.
- Local cloud-adapter verification: 12 images, same cover bytes as the existing local renderer, two concurrent sessions, ~1 second/post including local launch/close.
- 15 queue tests cover duplicate delivery, delayed retries, cancellation, watchdog, send failures, local isolation, old task snapshots, checkpoints, failed backup cleanup and real service orchestration with mocked hub.
- Build validation passed. Official @cloudflare/puppeteer includes an extract-zip advisory through its local browser-installer dependency; that installer is absent from the Worker bundle and this implementation never downloads browser archives.

# Verification and activation
- Real Cloudflare baseline: 20 posts / 120 images, 54.363 s wall time, 92.080 s summed browser lifecycle, 4.604 s mean/post.
- Optimized real Cloudflare: 20 posts / 120 images, 53.582 s wall time at concurrency two, 83.923 s summed browser lifecycle, 4.196 s mean/post, p95 5.854 s. Normal network variance limits interpretation of the timing difference.
- Cloud binding reports maxConcurrentSessions=200. Cover/content/stock-overlay JPEGs were visually inspected: no clipping and readable wrapping/emphasis. Source fixtures are synthetic; no AI or live publishing tests ran.
- Immediate browser history did not return matched finalized metering records (meteredBrowserSeconds=null). browserMs is measured lifecycle elapsed time, not exact billed seconds. Extrapolating 600 posts gives ~42 browser-minutes; do not promise a ten-minute free daily allowance is sufficient.
- Deployment stages: f96af12 added cloud infrastructure with default off; 9f70397 optimized browser IO with default off. Final activation sets PSYCHOLOGY_CLOUD_PHOTO=true for newly created photo tasks only. Existing local jobs are untouched; no local worker restart.

# Unfinished work / limits
No full real AI→hub→TikTok publishing load test, and no 600/7,200-post production run. Source AI quotas, upload delays, D1/R2 costs and platform account limits remain separate from the render benchmark. Production default activation deployment is verified in the task response.

# Recommended next step
Observe the first operator-created photo batch through cloud job status and hub receipts. To roll back only future tasks, set PSYCHOLOGY_CLOUD_PHOTO=false through the normal commit/push/deploy workflow; let existing cloud jobs finish. Keep browser concurrency at two until real queue delay measurements justify increasing it.
