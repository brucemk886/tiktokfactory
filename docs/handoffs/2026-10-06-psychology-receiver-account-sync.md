# Receiver candidates missing after project transfer

## Goal
Explain and repair missing receiving-account candidates on the independent-site conversion page after accounts were moved into Psychology.

## Findings and decisions
- The funnel and receiver selector have no ten-account display limit. Eligibility requires current project scope, a valid handle, synchronized followers >=1000 and publishing permission.
- The recent transfer batch contained nine distinct account assignment updates. Three accounts had successful upstream follower metadata (1157, 1057, 1148) but no Factory archive row; two other accounts were below the current threshold (952, 987) in both upstream and Factory snapshots.
- Project assignment writes do not immediately backfill account analytics. Existing bridge pushes intersect the current archive scope; a new assignment can precede its next account-data push.
- Re-enqueued exactly three upsert messages through the existing signal-desk-factory-push queue. This preserved bridge scope checks and source timestamps; there was no direct database edit or publishing API call.

## Files changed
This handoff only. No runtime code or deployment changes.

## Checks performed
Read-only project-assignment, source-profile and Factory-profile checks. Queue submission accepted three messages. Subsequent Factory reads confirmed all three records with matching source follower counts and timestamps. Logged-in production website verification at 2026-10-06 21:27 Taipei showed nine receiver accounts, up from six at initial inspection. The original browser diagnostic session ended before export; final validation used a separate owned session which was closed.

## Unfinished work
Two transferred accounts remain ineligible under the synchronized follower threshold. Automatic backfill on project assignment is not implemented; this was a targeted operational repair. Confirmed receiver configuration and profile-link readiness were not changed.

## Recommended next step
If immediate receiver availability is required on every future project transfer, enqueue a scoped account-data refresh after assignment and display pending metadata explicitly. Do not infer readiness or relax the follower condition silently.
