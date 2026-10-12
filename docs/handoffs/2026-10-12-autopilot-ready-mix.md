# Autopilot ready-material mix

## Goal
Schedule one automatic operation campaign from the ready Video Hits library when the requested post count spans both videos and photo albums.

## Decisions
- content_schedule_json is an optional frozen per-slot sequence: video-hits-video, video-hits-photo, or library-photo.
- Existing plans keep their plan-wide content_source behavior when the sequence is empty or invalid.
- Ready videos and photo albums both use their saved content, one-time publication reservations, and the existing frozen receiver CTA when mention_receivers=1.

## Files changed
- Migration 0091.
- Psychology autopilot batch selection and focused tests.
- Current state and this handoff.

## Tests performed
- 89 focused autopilot, ready-photo, video-library and receiver tests passed.

## Unfinished work
- Create and verify the authorized production campaign after deployment.

## Recommended next step
- Verify the first 22:30 Beijing slot reserves twenty ready items and every item has a frozen receiver CTA.

