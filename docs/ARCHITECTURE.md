# Architecture

## Layers

1. `public/`: local browser UI.
2. `scripts/server.js`: authenticated HTTP routes and service composition.
3. `scripts/*-service.js` and managers: generation, publishing, analytics, and automation logic.
4. `work/`: runtime records, queues, caches, and Project Hub state.
5. `docs/`: durable human-readable context shared across chats and projects.

## Project Hub

Project Hub is the cross-chat project registry and handoff-memory layer.

- Each project has an objective, workspace path, and module list.
- Projects may be activated or hidden from the current operating view.
- Handoffs capture decisions, changed files, verification, unfinished work, and recommended next steps.
- Project Hub does not own an execution queue and no longer creates subproject Agents.
- Project Hub never publishes, deploys, installs packages, edits code, or calls external services automatically.

## State Ownership

- Git owns source code and reviewed documentation.
- Project Hub JSON owns project and handoff state.
- Existing task managers own generation and publishing queues.
- Secrets remain in environment variables or local configuration excluded from Git.

## Hosted psychology automation

- D1 psychology_publish_batches/items own immutable selection/account/schedule snapshots, current job links, photo asset checkpoints and submission receipts. Existing factory_jobs own execution state.
- Cloud peer-photo workflows generate page plans. New automatic photo source snapshots mark cloudPhotoRender and enqueue a dedicated Cloudflare Queue (one message/job, at most five concurrent consumers); old source snapshots keep existing local workers. Video generation keeps the existing render/publish lanes. Signal Desk owns final publication.
- public/psychology-card-renderer.js is shared by the manual photo page and the background photo renderer; automatic publication revalidates account access before execution.

## Psychology operations review

- scripts/psychology-operations.js owns pure date-window, media, account-performance and batch-funnel calculations.
- factory-cloud/src/psychology-operations.js exposes a scoped GET report over existing archive, publish-record and automation tables. The report does not enqueue or publish work.
- public/psychology-operations.* provides the separate review UI; the existing shared data overview remains on /psychology-effects.

## Psychology template topic banks

- D1 psychology_template_topics owns user-managed topics scoped by template; psychology_topic_imports owns idempotent import receipts; psychology_topic_usage owns allocation history.
- A single D1 batch commits the publishing batch, immutable topic snapshots in factory_jobs, publish items, and usage counters. Triggers guard stale revisions and concurrent only-unused selection; no external publishing call occurs in this transaction.
- The admin-only /psychology-topic-bank page and /api/psychology-template-topics manage banks independently of the peer-hit library. Automatic publishing retains peer sources for video/photo and uses topicSource for template-bank jobs.

## Psychology grouped publication

- psychology_publish_groups owns immutable groups of up to 20 posts, submission leases, frozen requests and remote receipts. psychology_publish_items.ready_json contains upload-ready media metadata and publish_group_id assigns fixed membership.
- Local video publish workers only upload assets and report readiness; photo workers reuse per-page uploads. The cloud coordinator submits a ready group once with a stable externalId and maps every task by externalRef. Existing ungrouped jobs retain their previous pipeline.
- Updated workers advertise psychologyBatchUpload; older workers cannot claim new grouped jobs. The publish lane remains tied to the render worker for local-file upload, but group submission no longer depends on files being on the same machine.

## Psychology publishing retry ownership

- factory_jobs owns available_at, auto_retry_count and retry_history_json. Workers release their lane after a failed attempt; claims skip delayed jobs. Photo uploads/video upload jobs retry at most twice; grouped submission retries are dedicated psychology-publish-submit jobs requiring the psychologyPublishRetry capability.
- Factory official records use a stable per-item ID for submission failures and later successful receipts. Historical missing failures are backfilled without resubmission. Signal Desk continues to own remote TikTok publication/review outcomes.


## Psychology recovery and capacity

- Unfrozen publication groups can move failed/overdue unfinished items into isolated groups under the existing submission lease. Frozen requests remain immutable except after the hub explicitly rejects missing/expired photo assets before batch creation; recovery preserves externalId and item references. The dedicated five-minute cron only reconciles psychology groups and deletes completed/deleted backup objects, never runs the heavier daily maintenance steps.
- Photo bytes are copied to private ARCHIVE objects before hub upload; per-item photo_backups_json stores references. Recovery requeues the existing card jobs and state restores saved bytes through the hub upload API, with durable per-page checkpoints. Previously deployed workers need no protocol change or restart. Old items without backups regenerate from their stored plan. Two automatic recovery cycles bound repeated expiration.
- A short per-D1-binding account directory cache reduces repeated reads; local user/group permissions are still read on each check and final group authorization is fresh. Transient claim failures share durable delayed retries and official failure records.
- psychology_peer_account_usage reserves source/account pairs in the same D1 transaction as parent jobs; uniqueness rejects conflicting concurrent allocations. Explicit operator reuse bypasses the unique allocation insert via INSERT OR IGNORE. Existing item history backfills reservations; peer ranking favors less-used sources.

## Cloud psychology photo rendering

- PHOTO_BROWSER runs the shared public card runtime in isolated Chromium. Workers load trusted template source through ASSETS, render at most six pages per call, close Chromium, then persist each JPEG in private R2 and upload via existing restoration checkpoints. Source backgrounds are prepared before browser launch, with per-image and total buffer caps.
- PHOTO_QUEUE transports IDs only. factory_jobs remains authoritative for status, cloud_dispatch_at, cloud_lease_until, available_at, and business retry history. A dedicated minute cron dispatches due/unacknowledged jobs and recovers leases older than the consumer maximum runtime. SQL compare-and-set ownership prevents duplicate execution and stale completion.
- New source payloads freeze execution mode at creation; PSYCHOLOGY_CLOUD_PHOTO controls only future photo batches. Cloud-marked group retry jobs use the same queue. Changing the default back to false does not move in-flight jobs or stop the existing cloud queue.
- The authenticated worker render probe creates synthetic images only; it does not enqueue production jobs, generate AI content, or call the publishing hub. Runtime browserMs measures launch-to-close elapsed time and is not a billing API total.

## Psychology scheduled reveal comments

- psychology_comment_templates stores future-batch defaults; psychology_template_topics.reveal_comment stores the per-question answer independently of the public video script.
- psychology_scheduled_comments freezes each item's answer, delay and teaser atomically with generation/usage. No automatic enrollment of old jobs; disabled defaults create no comment records.
- Minute maintenance isolates comment processing from photo dispatch failures. Bounded claims use leases and cached hub batch receipts. Confirmed published status plus video ID and actual publishedAt (or conservative completedAt) establishes due_at.
- Revalidate originating user, assigned psychology account and comment.list.manage before sending. Hub externalId is psychology-reveal:<itemId>. Recover lost POST replies by GET before repeating the same ID. Unknown outcomes require review; manual checks cannot create a missing request. Unsent tasks can be cancelled.

## Per-account publication readiness

Signal Desk accepts structurally valid hub batches before contacting TikTok for account publishing settings. Each durable preparation task checks the original owner/account, privacy and comment constraints independently for photo and video posts. Permanent account errors fail that task; transient errors use the existing bounded preparation retry queue. Batch external IDs and item references remain unchanged. Asset validation and customer ownership checks still occur before acceptance.

## Psychology source-copy cache

- `peer-photo-copy-cache.js` stores only validated original text plans in D1 `psychology_photo_copy_cache`, keyed by operator and versioned TikTok post identity (canonical numeric ID, otherwise share-link path). Each page keeps its original text, 1-based position, layout type and background description; no source images or signed URLs are stored in this shared cache. Entries are bounded to 128 KiB.
- `peer-photo-workflow.js` first reads/claims the shared entry using an atomic expiring lease. Other workflows sleep durably and reuse the completed extraction; failures release the lease, expired leases can be reclaimed, and malformed cache records are invalidated with compare-and-clear.
- First extraction always disables rewriting. Only after the validated original is saved does a requested rewrite run using text alone. Template overrides and generated backgrounds remain per-job. Temporary source R2 images are deleted after extraction and again on cleanup if needed. Historical jobs are not inferred into the cache because prior results may have been rewritten.

## Psychology copy library

- `psychology_copy_library` is the durable original-copy inbox. The peer-hit store mirrors accepted imports and type corrections in the same D1 batch. Migration 0043 recorded existing hits; migration 0044 sets their unfinished rows to `auto_extract=0`, leaving historical processing to Grokbot. Metric refreshes update source metadata without replacing completed text; media-type corrections invalidate the old extraction with an incremented attempt.
- A minute dispatcher claims at most three `auto_extract=1` rows across both media types. Stable workflow IDs and attempt-guarded writes reconcile uncertain dispatch outcomes without duplicating paid extraction. One malformed source is failed independently and cannot block later rows. A two-hour timeout requires an explicit retry instead of blindly repeating paid analysis.
- Photo extraction shares `psychology_photo_copy_cache`, records indexed original text for up to six source images and exits before rewriting, stock search, rendering or publication. Video extraction temporarily downloads the source to private R2, stores Kie usage in the existing analysis table, extracts the original-language transcript plus ordered on-screen text, and deletes the temporary source in all outcomes.
- `/psychology-copy-library` is the canonical combined source/copy UI with video/photo tabs; old peer URLs redirect after authentication. Its GET defaults to completed copy and optionally filters all imports, active extraction states or historical opted-out records, joining source metrics by exact ID and owner-scoped rewrite counts by canonical source key. Source-management UI is gated by its existing peer permission; either legacy peer or copy-library admin access permits copy viewing and rewrite management. Original-source deletion retains extracted copy and existing tasks. The source table, extraction table and Grokbot write-only API remain separate and unchanged. Reviewed variants are nested in each original’s 改写详情. Exact canonical source keys link versions; source-bound imports validate a completed original and reject conflicting keys. The original list batches version counts for its current 20 rows; migration 0045 indexes owner/source lookups. Manual creation and bulk imports retain immutable IDs, snapshots and existing publishing rules. Extraction never creates a publish batch.


## Psychology per-video automatic replies

- psychology_reply_watches freezes owner/account/video/topic, four answers and time window; psychology_reply_items owns durable per-comment decisions and stable hub external IDs. The unique account/video/comment key survives repeated scans and pause/resume.
- The minute scheduler dispatches up to 120 due watches to REPLY_QUEUE; separate consumers process one watch/page per invocation. Topic edit stores reply_options_json independently of reveal comments and rendering content.
- Hub /api/v1/publish/comments/scan checks account scopes and indexed video ownership, fetches one official cursor page and stores comments before returning them. Factory stores continuation cursors; a completed traversal starts again after five minutes. Pending sends run by minute without repulling a completed page.
- Lease claims, account pacing and hub receipts protect concurrent processing; ambiguous choices, own comments and nested replies are skipped. Pause prevents subsequent sends; an in-flight request may complete. No AI interpretation or implicit enrollment of historical batches; opted-in future template batches enroll via confirmed publication receipts.

## Psychology photo creative tracking

- New photo tasks draw independently from the twenty active styles, frozen in psychologyAutomation.styleId and creative snapshots at creation. Fixed account/group allocation is paused; D1 psychology_style_bindings remains available for compatibility but is not read by batch creation. Legacy group requests normalize to random for new batches; existing jobs retain their frozen styles. Shared Canvas modules render twenty text-only cover/content styles, loaded via blob modules in Browser Run and local static modules in Chrome.
- psychology_copy_variants owns immutable reviewed title/caption/page snapshots keyed by owner/externalId. Text-only imports bypass source extraction and rewriting; peer extraction/cache remains independent. Existing source/account reservation transaction also guards imported variant reuse.
- psychology_creative_snapshots stores per-item source, variant and style identity. enqueueAutoPhotoRender persists final title/caption/page fingerprints before render dispatch. Reports join exact task/account/video identities, use archived available metrics and preserve unknown historical metadata.

## Shared psychology copy sources

- psychology_copy_library completed originals feed both video and photo creation through psychology-copy-source.js. Original media type is independent of output media; enabled rewrite variants remain owner-scoped. No new extraction queue or table is introduced.
- Task payload.copySource freezes full original/variant content and identity before execution. Existing account/source reservations and idempotent batch receipts cover both new source types. Source lists distinguish originals, rewrites, topics and peers.
- Stored-copy photo sources are text-only variant plans that bypass paid extraction; video sources become template script inputs without media fetches. Oversized photo plans (>6 pages) or video inputs (>5000 characters) fail before writes; operators can save concise variants. Template reveal comments still require topic-bank answers.
