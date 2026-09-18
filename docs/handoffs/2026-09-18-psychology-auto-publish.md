# Goal

Replace the online psychology video-publish picker with a peer-hit-driven automatic publishing workflow for photo posts and videos.

# Decisions

- Keep the existing /psychology-publish URL and module ID; label it 心理学自动发布. The new workflow is administrator-only, consistent with peer-hit/photo production access.
- Each batch selects 1–50 distinct peer hits of the chosen media type, optionally filtered by title/account keyword; selection can be random, popularity-first or newest-first.
- Count means total posts in the batch. Selected official psychology accounts receive posts round-robin. Each account has a first scheduled time and an interval; the complete schedule must fit within 14 days.
- Video templates reuse psychology, psychology-collage and psychology-target-2 workers, with Z-Image and explicit official auto-publishing. Follow-up publish jobs have deterministic IDs.
- Photo templates reuse the cloud peer-photo workflow (including the separately shipped Gemini 3.5 → 3.8 fallback). The text-only choice bypasses Pexels. Completed plans enqueue a psychology job with photoAutomation; the existing freshly spawned psychology script dispatches the new JPEG renderer without restarting active workers.
- Shared browser card renderers serve both the manual photo page and headless Chrome on the worker. All pages must be uploaded before publishing; asset checkpoints and official receipts live in D1.
- Stable batch/item IDs prevent duplicate queue creation and repeat photo publication after lost responses. Failed jobs can be retried; photo analysis retries restart that failed analysis, while completed photo uploads are reused.
- Account scope is checked at creation, worker claim and photo submission. Disabled users and revoked account assignments cannot publish queued automatic jobs.

# Files changed

- factory-cloud/migrations/0028_psychology_auto_publish.sql
- factory-cloud/src/psychology-auto-publish.js, psychology-auto-photo.js and tests
- factory-cloud/src/index.js, entry.js, jobs.js, auth.js, pages.js, sidebar.js
- factory-cloud/src/peer-photo-workflow.js and its production tests
- public/psychology-auto-publish.html, .css, .js
- public/psychology-card-renderer.js and psychology-photo.js
- scripts/psychology-auto-publish.js, psychology-auto-photo-job.js and test
- scripts/psychology-video-job.js
- factory-cloud/package.json

# Tests performed

- Full factory-cloud npm test: 367 passing, including the text-only workflow case and real headless JPEG worker test.
- Browser QA on desktop 1440px and mobile 390px: media switching, template selection, account allocation, submission, persisted queue and no page overflow.
- Real headless Chrome JPEG rendering for cover/content/stock overlay pages; inspected desktop UI and card output.
- SQLite/API mocks cover media isolation, exact counts, unique sources, account permissions, scheduling, duplicate submission, workflow dispatch recovery, deterministic publish follow-up, complete ordered photo sets, worker ownership, upload resumption and stable receipts.
- No real TikTok posts or paid generation jobs were created during tests.

# Unfinished work

- Live generation/provider success depends on the existing configured Kie/TikHub/Pexels/TTS services and an available worker with this commit and Chrome. No live posting was used as a deployment smoke test.

# Recommended next step

Open /psychology-publish, select media/template/count and official psychology accounts, then create a batch with enough lead time for generation. Follow final TikTok outcomes from 官方发布记录 after items show 已提交中台.
