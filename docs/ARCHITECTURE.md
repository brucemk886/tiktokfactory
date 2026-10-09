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
- Cloud peer-photo workflows generate page plans. New automatic photo source snapshots mark cloudPhotoRender and enqueue a dedicated Cloudflare Queue (one message/job, at most twenty concurrent consumers); old source snapshots keep existing local workers. Video generation keeps the existing render/publish lanes. Signal Desk owns final publication.
- public/psychology-card-renderer.js is shared by the manual photo page and the background photo renderer; automatic publication revalidates account access before execution.

## Psychology operations review

- /psychology-effects reads analytics, publication receipts and profile traffic for the selected psychology scope. Its UI and API have no account/content pool adapter. Pool review remains owned by the separate operations reporting service.

- scripts/psychology-operations.js owns pure date-window, media, account-performance and batch-funnel calculations.
- factory-cloud/src/psychology-operations.js exposes a scoped GET report over existing archive, publish-record and automation tables. The report does not enqueue or publish work.
- public/psychology-operations.* provides the separate review UI; the existing shared data overview remains on /psychology-effects. Reports default to the Beijing calendar day. The summary omits heavy creative text/plan columns; details=1 loads the expanded comparison using the same scope. Interactive archive loading uses a bounded 24-reader pool without read-path repair writes; other callers keep the default concurrency/repair behavior.

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

## Autopilot configurable schedules

- psychology_autopilots slots_json/schedule_timezone own current local daily times; pending_slots_json/pending_schedule_timezone and slots_effective_at own the future whole-day schedule (0057/0072). Legacy plans default to Asia/Shanghai, while Pacific project schedules use America/Los_Angeles. One slot means one post/account, with 1–10 slots/day. Settings apply after all already-reserved slots. Optimistic revision and slot-boundary checks protect concurrent planning; future settings already used for reservation cannot be overwritten before their effective date. Existing item schedules remain immutable.
- Autopilot calls auto-publish with an internal productionLeadMs option. It freezes psychologyAutomation.generateAt and factory_jobs.available_at from each post time minus two hours. The photo workflow sleeps durably before provider work and rechecks stopped jobs on wake. Ordinary manual auto-publish calls retain immediate generation. Existing jobs are unchanged; cron cadence and publishing queues remain unchanged.

## Independent psychology operating task groups

- Migration 0070 adds one project controller with owner-scoped configuration, seven-day cycles, three-day role reviews, a durable enrollment registry, and future-effective membership history. Migration 0071 adds project-bound enrollment: configuration identifies the psychology project, and current eligible accounts plus later authorized accounts join automatically. Legacy selected-plan policies retain their behavior until explicitly switched. Permission groups remain administrative assignments.
- psychology-task-groups.js owns previews, revision-guarded changes, permission checks, role selection and history. psychology-task-group-execution.js bridges roles to existing permission-group delivery plans and automatically discovers compatible owned pool plans or creates a default three-round executor where none exists, including bootstrap with no prior plan. Conflicting plans block their affected accounts; paused plans and the latest historical account pause remain preserved. Current permissions and pauses are rechecked for execution.
- Scheduling reads the membership valid at the slot time. New memberships and changed roles take effect after reserved dates; frozen items and prior slot assignments are retained. Daily round claims (project policy/account/operating-local date/round 0–2; the beijing_date column retains its legacy name and time_zone records its interpretation) commit with publication items, preventing duplicate rounds and more than three scheduled posts per day across task executors. Supplementary batches cannot cross the original date or cycle end.
- Stable review members prioritize fixed-version tests in two rounds and a winner in the third. Exact version/style sample caps and source reuse remain shared. Fresh mature account evidence can prohibit cold testing before the next role review. Other roles retain the existing pool quotas and diagnostic protection. Task role/revision/effective time is frozen in each matched job payload. No 24-hour provisional promotion is introduced.
- Scheduled execution reconciles enrollment before keyset-paging all active delivery plans. A seven-day policy expires without automatic renewal; changing settings inside an existing cycle does not extend it. UI task-group cards and paginated members live on the autopilot page, separate from analytics and administrative account groups.

- scripts/psychology-schedule-time.js converts IANA local calendars to UTC, rejects nonexistent spring-forward times and chooses the first fall-back occurrence. Cycles and review intervals advance calendar days rather than fixed 24-hour multiples. Each match freezes its time zone. Historical analytics remain Beijing-date reports and UI labels distinguish them from operating dates.
- A project timezone change is allowed before its cycle starts only if no frozen reservation or publish item exists on or after the earlier of the old/new boundaries. One revision-guarded transaction rebases the same date labels, future roles and compatible plan schedules; pauses and all jobs/items remain untouched. Late changes must wait for a new cycle. Project-managed manual schedule edits retain the project timezone and three rounds. Existing incompatible plans block their accounts rather than silently running in another zone.

## Autopilot version test allocation

- New autopilot batches freeze libraryTestPolicy=balanced-v1. psychology-copy-testing.js reads the owner-scoped 30-day photo-item/creative/job/group/receipt history to count occupied tests, independent of the twice-daily mature-performance rollup. Pending, live retries and uncertain remote outcomes retain slots; confirmed terminal failures/cancellations release them. Three occupied but unjudged samples block further selection until mature data arrives. Missing execution rows remain occupied conservatively.
- Migration 0058 records a unique (owner,revision) allocation alongside the batch, creative snapshots and source/account reservations in one D1 transaction. Revision is read before the snapshot; competing fair allocators cannot both commit a stale quota view. Losers return a clear 409 and must read again. Existing manual library draws retain their legacy behavior and are counted on subsequent test snapshots, but do not participate in the new allocator serialization.
- A cold start alternates available original/rewrite trials, then draws ~70% mature winners / ~30% trials. B permits originals only, C rewrites only. Up to two unjudged enabled rewrites per source are active, started versions first; new versions open as results mature. Per-account source reuse and within-batch version duplication remain forbidden. Insufficient eligible content creates no batch. Pair seeds are owner + operating-local date + daily slot ordinal, permitting staggered groups to share a candidate order while respecting differing histories/capacity.

- Explicit startNow on autopilot creation persists start_now (0059). Only slots on the creation operating-local date use the ten-minute minimum scheduling lead; default/other dates retain two hours. This permits authorized short-notice starts without backdating creation or mutating scheduled items. Generation still freezes max(creation time, scheduled time minus two hours), and reruns reuse the existing slot claims.


## Autopilot operations reporting

- Psychology operations maps autopilot slots (including comma-separated batch IDs) to exact publish items and stable psychology:item receipt records. Group comes from the persisted pilot; strategy prefers frozen batch configuration and falls back to the pilot. Both allowed pilot groups and currently authorized account memberships constrain reads. Manual batches are not inferred as autopilot by name or ID prefix.
- Execution uses each item scheduled publication date, so batches/receipts created earlier still count on the target day. Assigned accounts without analytics packs remain present for execution counts. Missing metrics are null, not zero; metrics match account plus video ID and are deduplicated.
- Interactive frameworkFor requests matureOnly:false; today's synced posts participate in overview, account/content comparisons and A/B/C rates immediately. Shared scheduler calls retain the default matureOnly:true, preserving allocation/automation behavior. Content detail comparisons also include all synced samples. No additional TikTok request, publishing operation or migration is introduced.


## Fast operations report reads

- official_report_video_cache (0060) stores only the latest per-account report metrics, bounded to100 videos. Account ingestion writes the projection with the matching account timestamp in the same D1 batch; deletion removes it. Covers/download URLs and unused analytics payloads are excluded. Raw R2 packs remain available for detailed archive consumers.
- loadReportContext batches current canonical assignments, settings and lightweight profile columns; empty canonical assignments cannot fall back to legacy grants. Report query inputs are a second D1 batch, including resolved-item history and topic tags. Permissions are re-evaluated before any cached metrics are returned. No user-shared rendered response cache is introduced.
- Cache version and synchronized timestamp must match. Legacy/missing/malformed projections use the existing raw archive once and conditionally backfill only if the account timestamp is still current. Concurrent newer syncs cannot be overwritten. Unsynced accounts retain execution counts without repeated empty R2 reads.
- Server-Timing remains available for scope, queries, video loading, framework and total request timing. Report loading neither triggers TikTok synchronization nor modifies active generation/publication.

## Scalable psychology report facts (0061)

Interactive reports use official-report-account-scope.js to resolve stored aliases and lightweight profile identities into one account before counting and joining facts. The direct primary assignment controls current group access; stale aliases cannot restore moved or removed grants. Unsynced assigned accounts stay in the population. Overview analytics, receipts and traffic also intersect granted groups with the selected module project.

The interactive /api/psychology-operations endpoint now delegates to psychology-report-query.js. Its source is ops_video_facts plus reconciled ops_task_facts; ops_daily maintains additive scheduled-day/publication-day totals by account, frozen pilot group/strategy and version kind. Current canonical assignments constrain every read. SQL aggregates and exact weighted medians return bounded summary sets; all detail populations use server pagination. Account and content analysis are lazy. The earlier per-account 0060 cache remains a legacy consumer/backfill input, not the interactive report read path.

Archive ingestion writes normalized video observations with timestamp guards. Lightweight source triggers only enqueue task IDs. psychology-report-facts.js drains versioned dirty rows in bulk transactions on the existing minute maintenance lane, independently of job execution. Random revision tokens prevent ABA races. Metrics upserts update only their attributed task; one account/video identity contributes metrics once. Additive rollup triggers subtract prior contributions and add current contributions; metadata-only refreshes skip this work. Source pruning does not delete durable reporting facts.

Migration walks existing sources by keyset cursors and bounded archive batches in the background. Read requests do not backfill or call TikTok. UI migration/backlog indicators distinguish incomplete migration from a true zero. Generation, publication, scheduler maturity and selection remain owned by their existing modules. SQL window/CTE comparisons are interactive analytics, not an automatic decision-system migration.

## Copy library usage and effects

- factory-cloud/src/psychology-copy-usage.js is a read-only content adapter behind the existing library permission. It resolves shared canonical source identities, owner-scoped variants and immutable selection timestamps, and consumes the existing deduplicated local metric facts. Domain output is only copy/version inventory, draws and statistical observations. It does not invoke downstream workflow controllers or expose account/group/task management.
- public/psychology-copy-usage.* is a library child page with backend pagination and lazy version/body reads. Inventory is current; usage uses selection time; effects use actual publication dates and latest cumulative metrics. No read-triggered remote sync, repair or mutation.


## Parallel photo content factory

- photo_directions/copies/pilots/slots/jobs/source_uses/import_keys own the new photo-only domain (0062), isolated from psychology content and scheduler tables. An owner-scoped direction config defines tags, language/audience, rewrite model/rules, structure, aspect, page constraints and style choices. Jobs freeze config revision and exact content.
- photo-factory.js exposes admin UI APIs and direction-bound external text imports. These keys cannot publish. New trials are drafts; active legacy psychology groups/accounts block enrollment and execution. The old seven-day run is unchanged.
- photo-factory-execution.js uses a separate PhotoFactoryWorkflow with bounded minute planning and two concurrent preparation workflows. Durable local reservations and frozen hub request/externalId retain idempotency; no new factory_jobs or psychology task rows are created. Shared rendering keeps legacy defaults, and shared official transport owns remote publication.
- Reports join new jobs to existing locally synchronized ops_video_facts by exact account/video identity. Copy inventory and version effects remain separate from publishing controls. No read-time remote sync and no inferred migration of old observations.

## Psychology external management boundary

- psychology-management-api.js authenticates scoped psy_manage_ tokens against the current administrator, then delegates only explicit report/autopilot/style operations. Import keys retain their original separate boundary. D1 owns hashed keys, owner-scoped report presets, style overrides and idempotency fingerprints (0063).
- Report metrics reuse the existing overview/scalable-report services and remain read-only. Autopilot creates paused through this adapter, requires revision-aware explicit activation and uses the existing scheduler. The external list is paginated.
- psychology-managed-styles.js resolves built-ins plus owner changes. Photo creation persists the full validated style definition into the immutable job payload; local and cloud renderers use that snapshot. Subsequent edits never restyle existing tasks.

## Project unified API

- `factory-api.js` authenticates one active project key, validates bounded module/action envelopes and dispatches only the fixed operations in `factory-api-catalog.js`. Business modules retain authorization, ownership, revisions, scheduling, publication and quality rules. Trusted actor adapters are server arguments, never request-provided claims.
- `factory_ai_keys` stores the singleton project key hash and owner. `factory_ai_requests` stores durable mutation claims and JSON receipts, keyed by owner/request UUID. Unknown results stay claimed and cannot automatically repeat; key rotation does not remove claims. Reads delegate normally.
- `/factory-api` is the admin key/catalog UI. Legacy scoped API entry points remain compatible and do not inherit the broader project credential.

## Read-only ChatGPT MCP (2026-09-27)

`factory-cloud/src/entry.js` wraps the existing fetch handler using `factory-mcp.js`; cron/queue/workflows are retained. OAuthProvider owns metadata, registration and tokens, with explicit factory-session consent. `factory-mcp-tools.js` exposes 19 allowlisted business read tools and dispatches through `callFactoryRead`, a server-only adapter over existing unified API handlers. Current user permissions and D1 connection revocation are checked on every request. `OAUTH_KV` is separate from application storage; migration 0065 holds only connection audit metadata. See FACTORY_MCP.md for protocol and setup details.


## Topic image generation and assets

`topic-image-operation.js` owns a durable operation identified by owner + request UUID, backed by migration 0066 and `TopicImageWorkflow`. OpenAI generation is claimed atomically once, without provider retries. R2 image bytes and operation/hash metadata form the durable recovery checkpoint; `topic-assets.js` owns asset reference validation, ownership and bounded batch hydration. The existing topic importer remains the single topic insertion path and its fingerprint includes asset references. Defaults disabled; no publishing call. `factory.topics.write` is explicit extra OAuth consent, separate from existing read tokens. Existing image key format/renderers and workflows remain compatible. See FACTORY_MCP.md.


## MCP topic image ingestion

- topic-file-import.js accepts authenticated file references or app-only PNG byte uploads. URL inputs use bounded downloads and per-redirect source checks; local bytes traverse the existing OAuth MCP JSON channel without a separate multipart auth endpoint. No generation API is invoked.
- topic-png.js validates static PNG chunks/CRC and decodes DEFLATE scanlines (including Adam7) with bounded row buffers. Bytes and signed URLs never enter operation JSON; URL input fingerprints retain file ID and byte inputs use a SHA-256 identity.
- Both paths share factory_ai_operations leases, immutable R2 checkpoints and topic import receipts. Native ChatGPT file availability is a host capability. The URL pattern is a compatibility policy, not proof of domain ownership.


## Single-image topic inventory (0067)
- psychology_topic_images stores multiple images for one psychology-target-2 parent. Existing insert/update paths seed the primary image through SQL triggers, so browser, integration, unified API and ChatGPT imports share the same inventory. Parent text, choices and reveal are shared; operators must keep option semantics aligned across images.
- Single-image selection joins enabled parents to unused enabled images; one batch may use multiple images from one parent. Global fingerprint claims in psychology_topic_image_uses commit atomically via psychology_topic_usage triggers with publish batches/jobs. Repeated, stale or competing draws roll back; onlyUnused=false never reuses a single-image claim. All other templates keep parent-level usage rules. Failed/cancelled jobs do not release images, and retries retain frozen sourceImage and topicSource.imageId.
- Migration conservatively consumes existing used primary images without touching active jobs. Modern uploaded bytes and factory assets use SHA-256 identity; legacy unregistered object keys and remote URLs use reference identity. Different historical keys or remote URLs are not a promise of visual/content deduplication. Pool enable/disable and parent edits never erase claims.
- Kie Nano Banana generation reuses TOPIC_IMAGE_WORKFLOW and factory_ai_operations under mode=topic-pool. Stable owner/request IDs, a SQL pending claim and recorded provider task ID prevent repeated paid submissions. Polling sleeps durably; PNG download is bounded to 8 MB, actual decoded PNG and <=4096 dimensions. Durable R2 content is reused after storage/import retries. A generated image is inserted disabled for operator review, with a topic revision check and no publishing.
- Cookie admin routes and existing topic integration credentials expose paginated images, add and enable/disable; unified Factory catalog adds topics.images.list/add/update. Image management requires the existing topic-bank permission. The Kie paid generation UI uses cookie auth and explicit submission; external import does not imply automatic generation.

## Adaptive psychology generation and new-account admission

- `psychology-production-capacity.js` reads the physical shared queue using each item's current job link, including other owners and independent cloud jobs. Recently completed cloud render `elapsedMs` supplies service P95; planned waiting time is excluded. Fewer than 20 samples retains a five-minute floor; effective concurrency is conservatively ten of twenty consumers with a 45-minute buffer. The estimated requirement is rounded up to 15 minutes and bounded to 2–3 hours; uncapped demand remains visible as a capacity warning.
- `psychology_generation_plans` stores initial and current preparation time separately from retry `available_at`. Only new internally scheduled adaptive parents get a row, in the same transaction as selection and daily claims. They are dispatched when due rather than starting a long sleeping Workflow. Three daily Pacific checks (05:00/08:30/17:00) reevaluate only untouched parents and never delays an already saved generation time. Stable IDs, dispatch leases and atomic start claims handle lost replies and cancellation. Existing legacy Workflow steps keep their original wait behavior.
- Project assignment timestamps only change when the actual account group or its project changes. The three operating checks discover new bindings; binding does not trigger an extra check. A durable per-round claim prevents duplicate scans. Outside a 15-minute delivery grace window, the existing minute clock gate performs no account/forecast database scan. A failed round waits for the next check; actual due generation dispatch remains independent. New project members start at the next operating calendar day based on the recorded binding event, respecting their own pre-existing frozen work and cycle bounds. Reconciliation can add missing accounts to future slots without changing existing accounts' items, publication times, or content qualification.

- The three checks persist owner-scoped capacity snapshots in factory_kv. Autopilot GET only reads the caller snapshot; page refresh does not recalculate production capacity or inspect other owners.


## Psychology project pool dashboard (0074)

- psychology-autopilot-dashboard.js exposes an authenticated GET projection over canonical current psychology accounts and durable ops_task_facts, independent of paginated delivery-plan lists. Pacific publication/scheduling day cohorts, rolling 30-day mature classifications, exact text/style evidence, controller-owned current inventory and current/future roles have separate fields. Detail reads are paginated and preserve current project permissions.
- psychology-pool-observations.js compares mature publication cohorts using latest cumulative metrics and captures true per-account pool observations only during the existing three claimed production checks. Random capture tokens, atomic batches and bounded 14-day retention preserve replay immutability. GET never creates observations, runs account planning, calls remote analytics or scans capacity.
- The automatic-operations UI has overview/account/content tabs; original mutation controls remain in execution details and existing dialogs. Snapshot movement starts after rollout rather than inferred history. Data Overview remains unchanged.

## Psychology one-day transition operations

- psychology-transition-day owns an explicitly enabled, owner-scoped bridge on the Pacific operating day immediately preceding the formal cycle. It reserves only the remaining midday and evening rounds, with fixed eligible account membership and independent atomic round claims.
- The formal seven-day policy, three-day review dates, previous slots and existing jobs remain unchanged. Current project permissions, account pauses, actual binding dates and mature account/content qualifications are revalidated when allocating.
- Bridge jobs reuse exact-version pool matching, shared sample occupancy and the existing deferred adaptive generation plans. They use the existing three production checks; an explicit bridge-only run can recover a missed configuration window without changing the normal checking cadence.
- Each bridge invocation handles at most one group-round slot to bound Worker resource use. The explicitly requested UI run continues these bounded requests while progress is confirmed; failed or leased work stops the sequence. Durable claims preserve completed allocations after a lost response, and leases expire naturally before recovery.

## DeepPersona conversion reporting
- psychology-website-data.js is a SELECT-only projection over the additional DEEP_PERSONA_DB binding. It does not initialize or migrate the site's schema, copy customer records, expose credentials, or write either database. Existing site tables remain authoritative. A primary-first D1 read session and one batch keep each response internally consistent.
- /api/psychology-website and the unified psychology/website.read action reuse fresh conversion module/project access and additionally require the existing campaign owner. Full-site totals are explicitly site-wide; resolving campaign IDs to account metadata uses only current authorized psychology accounts. Operators are denied.
- Traffic follows the site's existing quiz-start cohort and exclusions. Orders use payment time, include both product tables and later-refunded transactions, exclude preview/test/zero-price purchases, and never combine currencies. Gross price is not payout or net revenue. No email, answer, report snapshot, Stripe identifier or report-access URL is exported.
- The UI refreshes while visible every minute; reads are live, with no duplicated synchronization store or scheduled publication changes. Source failure preserves the last successful UI result as stale and returns an error rather than zero.
- utm_source=tiktok&utm_medium=bio&utm_campaign=factory-CONNECTION_ID is the account link convention, compatible with existing DeepPersona attribution. It identifies a receiving bio account; no exact upstream video attribution is claimed. Anonymous page counts have no account dimension. No historical attribution is fabricated.

## Branded receiver short links
- Migration 0077 stores immutable code-to-project/account mappings and Beijing-day request aggregates in Factory D1. POST /api/psychology-website/links reuses fresh campaign owner and account scope checks, creates only eligible receiver mappings, and is idempotent. Read routes never create mappings or change source-site data.
- DeepPersona's /go/ route delegates only a validated code, HTTP method and bot-classification headers to Factory through an HTTP service binding. Cookies, authorization, arbitrary destinations and supplied query parameters are not forwarded. Both layers return a no-store 302 to the fixed DeepPersona home page with the existing account campaign parameters.
- Only GET requests are counted; HEAD checks never count. Known user-agent bots and prefetch purpose headers are excluded from displayed visits, without claiming complete bot detection or unique humans. No IP, cookie, visitor fingerprint or customer record is stored. Count failures log an operational error and do not block navigation.
- Existing long URLs and quiz/order attribution continue to work. Links are created explicitly and remain stable after creation; profile setup and receiver readiness are still manual. Link statistics use current project/account permissions, cannot backfill historical clicks, and cannot identify upstream videos.

## Profile-to-payment conversion funnel
- DeepPersona owns traffic_link_state and traffic_link_clicks, initialized by its short-link worker using its existing schema-initialization pattern. Each branded GET records a random UUID, stable link code, campaign, click timestamp and basic bot/prefetch exclusion. HEAD does not create a visit. No IP address, visitor cookie, fingerprint, email or answer is added.
- The destination carries lf_click in its query. The visible-page client confirms arrival through a same-origin bounded POST /api/link-arrival; repeated page loads update the same record idempotently. Existing analytics opt-outs suppress this client confirmation and per-click quiz attribution. Tracking failures preserve navigation.
- The existing quiz_attribution.visit_id field receives the valid click token on session_started. The usual quiz-detail URLs already retain query parameters. No payment handler, report snapshot or question content changes.
- Factory remains SELECT-only against site D1. psychology-website-funnel.js joins the scoped click cohort with existing quiz attribution, sessions and live base-report purchases, aggregates by link and counts each click once per stage. A real quiz start also proves arrival. Later sessions/payments belong to the original click-date cohort; test-mode, preview and marked quiz sessions do not count as conversions.
- The new leading dashboard section uses UTC calendar days to align with TikTok daily profile data; existing historical site totals retain their clearly labeled Beijing scope. Missing profile days, unavailable tracking and dates before initialization remain explicit. Profile-to-click reference ratios require complete day/account/tracking coverage and are never presented as individual drop-off.
- Four website transitions display counts, conversion and loss rates as of the read. Unconfirmed arrivals include possible blocked beacons or privacy choices, and are not described as proven human abandonment. The dashboard supports receiver selection and a per-account comparison table.

## Durable psychology scheduling

- D1 psychology_schedule_work/members own planning progress; a dedicated schedule queue handles at most five accounts per step with lease-token fencing. Existing psychology_publish_items and factory_jobs retain generation/publication ownership. Slot and project/account/day/round identities remain idempotent.
- Three Pacific strategy checks create stable work. A separate five-minute watchdog reconstructs expected future rounds and recovers abandoned work; the Hub independently checks its heartbeat. Reporting reads and page refreshes never create schedules.


## Psychology interactive selected-video publication

- `/psychology-publish` keeps the template automation entry and adds a separate review-first video picker. Private uploaded assets and selected completed psychology jobs are stored through migration 0079; owner-scoped preview endpoints support byte ranges. Import queues a source-worker-pinned archive job only. All source files are immutable after reaching ready; source filenames cannot escape the configured output directory.
- The psychology TikTok One endpoint additionally accepts an explicit single-account `ensure` POST. It reloads the active administrator, verifies same-origin browser requests and current psychology account scope, then reuses the Hub membership check/join. It never creates content or publication jobs. The UI batches these calls sequentially with per-account results, project-keyed state, and retry controls; final publication still revalidates membership.
- The explicit confirmation endpoint freezes each asset/account/caption/AI label/schedule plus one canonical TikTok One project, rechecks current psychology account grants and archived ≥1000 followers, then ensures exact project membership before atomically creating a batch. Unknown followers fail closed. Stable owner/request IDs protect replay and reject changed inputs. Each video gets its own uploaded Hub asset and stable group item reference.
- Capability-gated `psychology-video-archive` and `psychology-selected-video` jobs use the existing authenticated worker protocol. The latter streams private R2 to Hub and reuses grouped publishing, receipts and bounded retries. Old workers cannot claim these types. The optional transfer sidecar claims only these types and never sends hello/requeue or restarts existing workers. No rendering, automatic planning or publication occurs merely from opening or previewing the picker.

- Psychology One picker GET `prepare` proxies Hub resource `membership` (no publishing-settings fetch); existing POST ensure/final publication remain separate. Three browser read workers show waiting/active/completed rows, abort stale selections, and bound each read to 30 seconds. The Hub bridge read has a 25-second deadline with actionable timeout text.
## Psychology video hit recreation assets

- `/psychology-video-hits` owns the source list, `/psychology-video-hits/recreations?id=SOURCE_ID` lists all created versions in numeric order, and `/psychology-video-hits/detail?id=SOURCE_ID&version=N` loads one version with source/recreated copy and aligned frame-image/text comparisons. All three routes reuse the same private shell, administrator/module permission and existing owner-scoped API. List pages do not preload frame/job details.

- psychology_video_hits/versions/frames own administrator-scoped original metadata/copy and twenty independently enabled recreation versions. Numbered frame pages align incomplete versions; private immutable images live in psychology_video_hit_assets/R2. Local transaction receipts and the unified API retain stable request IDs and CAS guards.
- Detail jobs GET projects the current owner-scoped render and active preview asset, checking source/version revisions and cleanup state without writes. The detail player reuses the existing private video-library file endpoint and preview archive lane; one automatic preparation attempt per page/render identity, explicit retry after failure, visible-page polling only while generation/transfer is pending, and shared browser-only covers. Stale/cleaned versions release the player and cannot auto-prepare.
- psychology-video-remix jobs freeze exact imported frames/script and version identity. The local renderer performs ElevenLabs narration plus FFmpeg image sequence/subtitle composition, then follows the existing psychology official publishing groups/items when explicitly requested. Capability-gated auxiliary rendering does not report hello/requeue or touch old planning.
- Type display reuses input_mode: video is imported ready video, frames is image/copy input. Source list counts both modes and uses an owner-scoped EXISTS filter before pagination; mixed sources appear once. Child lists combine type/publication scopes, retain version order and carry type filters through detail links. Cleared tombstones keep their input type; no migration or publish/cleanup mutation is needed.
- Same project-key binary uploads use a bounded dedicated endpoint; UI/worker image reads require current owner/module access, and worker reads are restricted to frozen assets of their running task. Original extraction/copy queues and paused autopilots remain independent.

## Psychology video-hit ready inputs

- Migration 0081 adds input_mode, ready video references and durable render/publication identity to each of twenty recreated versions. Private binary uploads are streamed through R2 with validated size/container headers and provider-verified SHA256; owner-scoped manifests reference immutable psychology_video_assets for the existing transfer worker. Session and project API uploads share current video-hit authorization.
- Ready inputs skip narration/rendering and use psychology-selected-video through the existing grouped official publisher. Complete matching frame renders reuse the original worker's MP4 through official-publish. Creation reserves one version and, for ready videos, one owner/file digest atomically. Legacy allocations are backfilled. Generic library publication cannot bypass the video-hit reservation. Current module and official account access are rechecked on execution.
- Database triggers preserve rendered status and confirmed publication/link against existing job/record pruning; submitted batches do not imply publication. Unfinished rendering/publishing jobs are untouched. Automatic file cleanup uses confirmed publication +24h and the reference-fenced lifecycle described below; shared or uncertain/unfinished work remains protected.

## Psychology video-hit asset lifecycle

- Migration0082 timestamps only durable actual publication confirmation; old confirmed versions get a fresh 24h rollout grace. Version/source tombstones preserve publishing identity, 20-version quota and owner/file digest uniqueness after content removal. Source originals stay until explicit all-published closure plus24h.
- Five-minute maintenance checks bounded candidates, frozen job-asset indexes and shared live frame/video bindings, then atomically claims deleting before exact R2 deletion. Writers pin active assets and refuse cleaned/deleting identities; provisional upload manifests cover interrupted writes. Queue/running and recent failed job references hold assets; failed deletion retries retain precise identities. Completed heavy job snapshots are compacted only for the cleaned version. General video-library assets without video-hit provenance remain outside this collector.
- Renderer temporary trees are removed in finally, preserving external input audio. Durable per-render local MP4 manifests survive routine job pruning. Cleanup jobs target only their original worker and require server-verified running ownership, confirmed/cleaned version and no transfer consumers; exact renderer filename and filesystem containment checks precede deletion. Completion is fenced behind cleanup acknowledgment. No existing worker or old plan is restarted.

- Migration0083 adds cleanup generations so late uploads reopen a durable deletion attempt without stale GC acknowledgments hiding it. R2 retries rotate by last touch/attempt. Only cleanup jobs get 15-minute stale recovery; completion receipts reconcile after interrupted worker acknowledgment. Original canonical output paths persist with local manifests; legacy paths are frozen by the original worker before unlink, while inaccessible roots or unlocated legacy files stay pending. Generated inventories exclude every cleaned source/version revision, including direct compose-and-publish jobs. UI and status distinguish logical content removal from physical file deletion.

## Manual video-hit publishing entrances

- /psychology-publish?create=one and ?create=normal mount the existing publishing components as standalone pages. The list has normal navigation links; creation never uses a dialog. One selection carries immutable videoHit source/version/revision and its concrete asset ID plus editable caption. Normal video-hits source uses selected-video template, explicit AI flag and saved captions, skipping generation.
- psychology-video-hit-publishing.js owns private candidate inventory, current-render/asset validation, and an atomic batch builder shared by selection and normal draw. The transaction pins active storage, compares source/version/render identity, reserves the durable version/item and imported owner/digest claim, creates groups of twenty, and writes jobs/items/usage together. The existing per-version endpoint shares these same durable constraints. Current composed local MP4s retain renderWorkerId; cloud-ready inputs use the existing selected-video transfer lane.
- Selected request config stores captionDigest rather than a second caption body; jobs retain the reviewed body and existing cleanup removes it after confirmed publication and grace. No schema change, background planning activation or worker restart is needed. Rendering, preview transfer and selection do not imply publication.

## Saved video-hit photo publication

- The normal manual creation page offers selected-photo with sourceType video-hits and an ordered photoVersions array of sourceId/version/revision refs. Session-only photo-library inventories eligible owned frame versions in pages of 12, with reasons for incomplete, unavailable or over-35-image albums. Existing administrator/module and official account/follower gates apply.
- psychology-video-hit-photos.js validates 1–35 ordered complete frames, freezes saved title (TikTok photo limit: 90 characters), caption and frame refs into cloud photo jobs, then atomically reserves the same durable per-version publication identity used by videos. Source/version CAS and private asset pins fence edits and garbage collection. Batch config contains refs only; groups, jobs, items and usage commit together.
- psychology-hit-photo-runner.js reads frozen private R2 files or validated bounded HTTPS image URLs. JPEG/WebP bytes are reused; PNG is decoded into a white-background JPEG with preserved aspect ratio (max 4096 px), without templating or generation. Sequential bounded reads keep at most one source/conversion in flight; existing photo checkpoints/backups skip uploaded pages on retry. The existing Hub photo uploader/group submitter carries original image order, saved caption, AI flag, rotating music and account schedule. Legacy generated albums retain their six-image limit.
- The shared version reservation excludes either-media repeat publication. Only official published confirmation begins the 24-hour grace. Cleanup removes recreated frames and completed frozen pages/plan copy; shared originals, active jobs and retry evidence keep existing protections. Temporary photo-upload backups are removed by the existing group receipt recovery path. No migration, new periodic planner or worker restart.
