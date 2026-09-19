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
- Cloud peer-photo workflows generate page plans, then enqueue existing psychology workers for headless card rendering. Video generation keeps the existing render/publish lanes. Signal Desk owns final publication.
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
