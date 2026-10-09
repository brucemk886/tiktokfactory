# Independent website receiving settings

## Goal
Keep receiver accounts and CTA configuration in Independent Website under a new 承接设置 tab, with separate saves and an explicit connection to imported-photo automatic publishing.

## Decisions
- Receiver and mention/self CTA sections save independently in existing per-user imported-photo config; no schema migration. Publishing accounts, AI marker and enable/pause controls remain in Automatic Operations. Settings saves cannot enable or pause operations.
- Final caption is the saved recreation caption, a blank line, then the saved CTA with exactly one {account} replaced by the routed @receiver. Receivers publishing themselves use a separate self-bio CTA. Stable account routes and draft previews are visible. Combined caption max 2,200; template max 1,000, no hardcoded handles/unknown tokens.
- Shared revision CAS preserves unrelated sections and fences concurrent planner leases. New tasks freeze captions and CTA snapshots; queued tasks and retries remain unchanged. Imported source copy/images remain unchanged.
- Website-only module grant can manage its own receiving settings within current account scope without content inventory or publication history access. Publication controls still require all publishing grants. Existing website report/short-link project-owner checks remain intact. Receiver labels/counts reflect new saved config when explicitly configured.
- Settings tab works independently of analytics availability, preserves other-section drafts when saving, supports a direct tab URL, and refreshes report data after settings changes. No live account configuration or publishing is performed during verification.

## Files changed
- factory-cloud/src/psychology-imported-photos.js and tests; psychology-website.js and tests; scripts/psychology-imported-photo-policy.js.
- public/psychology-website.html/js and new psychology-website-receiving.js/css; Automatic Operations summary in psychology-imported-photos.js.
- Browser regression tests, package test list, canonical/generated API guide and UI asset manifest; CURRENT_STATE, ARCHITECTURE and this handoff.

## Tests performed
- Focused mocked tests cover website endpoint → settings → planner final captions, self routing, separate-save preservation, frozen jobs, invalid templates/overflow, CAS, permissions/CSRF, and report receiver counts without legacy campaign mutation.
- Real Chromium verifies independent settings saves, preserved drafts, exact preview strings, saved account mapping, analytics outage resilience and overflow at 1440/390/320 px. Desktop/mobile screenshots inspected.
- Full declared factory suite passed all 1,467 tests, including publishing/queues, permissions and existing website views. All provider calls mocked; no live publishing. UI manifest and git diff whitespace checks passed.

## Unfinished work
Release verification pending. User still needs to configure their receiver/publisher accounts and enable the imported-photo mode.

## Recommended next step
Configure receivers and CTA at /psychology-website?tab=receiving, then choose publishers and enable imported-photo operations.
