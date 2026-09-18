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
