# Decisions

## 2026-08-02: Shared memory lives outside chat history

Different chats use repository documentation and Project Hub records as shared context. Full chat transcripts are not treated as the source of truth.

## 2026-08-02: Multi-Agent testing is read-only by default

Project Agents may inspect code and run read-only checks concurrently. They cannot edit files, deploy, publish, install dependencies, or call external services.

## 2026-08-02: Keep operational queues separate

Project Hub coordinates analysis and testing. Existing video generation and GeeLark publishing managers continue to own production execution.
