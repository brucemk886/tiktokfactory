# Single-image topic image pools

## Goal
One reusable single-image quiz topic, many images, each image drawn once. Allow bulk upload/import and explicit Kie AI image generation.

## Decisions
- Only template psychology-target-2 changes selection. Images, not parent topics, are the consumed inventory. Multiple images from one topic may fill a batch; topicSource freezes imageId and selected sourceImage. Do not recycle failed/cancelled draws. Retry the original job with its original image.
- Migration 0067 preserves old usage and marks previously used primary images consumed. Old images auto-enter pools via insert/update triggers across import paths.
- Global claim uses SHA256 for newly uploaded files and known factory assets; legacy unregistered image keys/remote URLs have reference identity. No perceptual duplicate/originality guarantee. Using a different URL for identical bytes is not detected.
- Image management: 20/page; add 1–50 image references; UI uploads files sequentially with partial results. Shared question/options/reveal remain parent's current version; user must ensure all images match.
- Explicit Kie Nano Banana button uses existing background Workflow and durable operations; one image per click, paid provider request at most once per requestId. Unknown create outcome never resubmits automatically. Known task IDs can resume polling/storage. Generated images are disabled until reviewed/enabled. Parent revision/permissions checked before paid generation and before insertion.
- Unified catalog and copyable topic read/write rules document images list/add/update. No paid generation exposed by generic image import.
- Root checkout's pre-existing edits untouched; implementation isolated in work/topic-image-pool.

## Files
0067 migration; psychology-topic-images backend/UI/tests; topic-pool-generation; topic image workflow dispatch; topic-bank handlers and UI; auto-publish selection/UI/tests; Factory catalog; docs; asset manifest.
Existing scale-p2 signature tampering test had a 1/256 chance to leave the signature unchanged (forced "00" prefix); test-only fix now always changes the prefix.

## Validation
Full suite passed 896 tests before final pre-generation revision guard/read-race adjustments; focused tests rerun below in deployment follow-up. Chrome fixture verified multi-upload, pagination, disabling, consumed protection and stable generation request IDs. Model/publishing calls mocked; no real Kie charge or production publishing test.

## Deployment
Pending commit/push/deploy at time of this entry. Follow-up records final deployment.

## Limitations / next steps
AI requires explicit operator enabling after preview. Remote URL imports should use stable URLs; prefer owned/uploaded assets for byte deduplication. No automatic replenishment or visual quality scoring. Paid provider smoke test should be initiated from a real topic by the operator when desired.

