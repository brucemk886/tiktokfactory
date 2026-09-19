# Compact official publishing records and failure diagnosis — 2026-09-19

## Goal
Constrain video/file, local task, batch and notes columns; show full values on hover. Identify why the historical photo task still failed.

## Decisions / files changed
- public/official-publish-records.html loads a page-specific stylesheet and scope class.
- public/official-publish-records.css constrains column widths and uses single-line ellipsis.
- public/official-publish-records.js preserves complete escaped text in native hover titles; links remain clickable and values remain searchable.
- No publishing task was retried, deleted or otherwise modified.

## Diagnosis
The most recent server-side failure for psy-auto-f350e1c22e2f737c455247ff4055f11d-002 remains 2026-09-19 11:55:39 China time, with 6 upload checkpoints, no receipt and no later execution. Read-only R2 retrieval of its first checkpoint asset returned "The specified key does not exist." The middle-tier storage cleanup removes unreferenced temporary assets after its orphan grace window; the factory retry currently trusts old checkpoints without checking remote existence. Consequently a complete upload checkpoint list does not prove that the files still exist. Missing assets must be reuploaded before this post can be submitted; generic retries of the old asset keys cannot repair that condition. No asset recovery or live resubmission was performed in this UI/diagnosis task.

## Validation
Headless Chromium with long quote/HTML-containing values: all four target cells clipped, title retains full original text, rows under 90px, link preserved, text escaped and no JS errors. Desktop screenshot visually checked at tmp/official-records-compact.png. Official record tests: 10 passed. Syntax and diff checks pass.

## Next step
Deploy after commit/push main. Follow-up for asset recovery should revalidate/reupload missing cached photos before submission and account for groups waiting longer than temporary storage retention.
