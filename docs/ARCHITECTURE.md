# Architecture

## Layers

1. `public/`: local browser UI.
2. `scripts/server.js`: authenticated HTTP routes and service composition.
3. `scripts/*-service.js` and managers: generation, publishing, analytics, and automation logic.
4. `work/`: runtime records, queues, caches, and Project Hub state.
5. `docs/`: durable human-readable context shared by chats and agents.

## Project Hub

Project Hub is the cross-chat and cross-agent coordination layer.

- Each project has an objective, workspace path, and module list.
- Each Agent belongs to one project and has one standing role.
- Agent runs use isolated Codex threads and a read-only sandbox.
- Runs are queued per Agent and may execute concurrently across Agents.
- Completed runs create persistent handoff records in JSON and Markdown.
- Project Hub never publishes, deploys, installs packages, or edits code automatically.

## State Ownership

- Git owns source code and reviewed documentation.
- Project Hub JSON owns orchestration state in the first version.
- Existing task managers own generation and publishing queues.
- Secrets remain in environment variables or local configuration excluded from Git.
