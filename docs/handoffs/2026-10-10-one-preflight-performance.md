# TikTok One preflight latency

## Goal
Investigate the stalled-looking One creation page and reduce time spent creating a selected-video task without changing the ongoing batch. The user subsequently requested withdrawal of the experimental ten-second submission interval; that companion change ships from the Hub repository.

## Evidence
- User screenshot shows 20 videos / 20 accounts with creation pending, selected start 2026-10-10 00:07 (UTC+8).
- Read-only production lookup found batch psy-select-73f8bc1000bf775cb9a77c2339b6f82b created at 2026-10-09 23:57:44.701 (UTC+8). At 23:58 it had 3 ready / 1 running / 16 queued; at 00:00:01 it had 7 ready / 13 queued with no errors. No original POST timing was captured; these reads establish ongoing progress, not an exact end-to-end latency.
- Creation checked every video's ownership/version/R2 presence sequentially and then called Hub ensure sequentially for all selected accounts. Hub ensure performs full publish preflight including settings. The initial page status stayed constant while waiting.
- The active video-transfer sidecar has one serial loop plus a five-second post-job polling delay. It was left running (PID 100756, original startup 2026-10-08 17:13:34). Group transport waits for the ready group before submission.
- At diagnosis time, Hub's One gate added ten seconds after each actual One response; it did not pace creation-time account checks. The user then explicitly withdrew this experimental cooldown. Companion Hub commit f14f342 removes it while keeping active-request coordination and global API throttling.
- At 2026-10-10 00:08:59 (UTC+8), the same factory batch had all 20 items/group submitted to the Hub, with no errors. This does not establish official One approval/publication.

## Decisions
- Bound each creation preflight phase to three concurrent operations; preserve input ordering. Stop admitting work after a failure and wait for all already-started checks before returning.
- Keep all account scope, follower, project/member, source/version and asset checks. Only commit the complete atomic batch after every check passes. Existing request replay skips new checks.
- Add elapsed seconds and explicit checking/upload stage explanation to the PC creation view, with timer cleanup on success/error. Frozen retry body and disabled control restoration remain.
- Do not change upload-worker concurrency, restart existing processes, modify queue entries, create a real test post, or replay existing items. The companion Hub change removes the fixed ten-second cooldown by explicit user request.

## Files changed
- factory-cloud/src/psychology-publish-checks.js (bounded/drained mapper), psychology-tiktok-one.js and psychology-video-library.js.
- public/psychology-auto-publish.js and generated asset manifest.
- One membership, selected-video backend and PC browser regressions; CURRENT_STATE and this handoff.

## Tests performed
- 70 focused backend/VM tests passed, including 20 accounts with peak concurrency 3, drain-on-error/no partial work, ordered asset results, no upload during creation and unchanged duplicate replay.
- Another 100 source/photo/group/publication integration tests passed (170 focused checks total). The real Chromium selected-video/photo flow passed, including the PC elapsed-second hint, error timer cleanup, disabled controls, and byte-identical retries. No real publication API called.

## Unfinished work
Released Factory runtime commit 8c6f074 after pushing main, from a clean exact HEAD == origin/main checkout via npm run deploy. Initial deployment uploaded code but one Workflow trigger update returned a transient fetch failure; repeating the same guarded deployment succeeded with all triggers, version 4a04e85c-6afb-4180-b118-a7364fd74b85. Live psychology-auto-publish.js returned 200 and its normalized SHA-256 matched the committed file. Companion Hub runtime f14f3421421550b6d1d24ac5f3761998e4c36616 deployed via npm run cloudflare:deploy, version 35c42ca2-09c1-47f7-9c13-d5edd3fbeb70; 45 focused tests and TypeScript passed there. No outstanding implementation work.

## Recommended next step
After release, use the PC creation page for the next batch; keep the existing batch running. Compare actual creation latency on a future user submission.
