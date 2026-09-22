# Goal
Replace all existing four-image psychology bank questions with three complete attachment-themed samples for review.

# Decisions and data changes
- Backed up and soft-deleted the 48 live template `psychology` questions through the authenticated topic API using revision checks.
- Created 3 disabled preview questions about waiting for a reply, a partner requesting time alone, and reconnecting after conflict. Each has four distinct ImageGen scene images, English option copy, and a full per-topic reveal comment.
- Content is framed as behavior-based self-reflection, not a validated picture diagnostic or an inference about a depicted person's mental health.
- Other banks remain 18 collage topics and 28 single-image topics. Existing publication snapshots and media were not removed.
- Scheduled-comment template toggle was already off and remains off. No publishing job was created.

# Artifacts
`work/attachment-topics-20260922/`: README.md, preview.html, topics-draft.json, image-prompts.json, 12 PNG assets, uploaded.json and import receipt. Private R2 images use the existing psychology-topics UUID namespace. Old-topic backup: `work/attachment-old-topics-backup.txt`.

# Validation
The real topic normalizer accepted all 3 questions and 12 choices; import returned created=3, skipped=0. Live page showed exactly 3 disabled questions with all reveal comments. All 12 authenticated image endpoints returned HTTP 200 image/png. Full browser decoding of all lazy images timed out; no image endpoint failed. Generated originals were visually reviewed before upload.

# Next step
User reviews the 3 samples in the four-image bank. Enable approved topics and, when desired, the separate scheduled-comment setting before automatic publication. No application code changes or deployment were required.
