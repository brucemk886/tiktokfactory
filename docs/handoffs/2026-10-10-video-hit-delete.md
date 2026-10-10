# Video Hits delete

## Goal

Let administrators and source owners remove imported Video Hits content that has not entered publishing.

## Decisions

- Source delete removes the source, original copy, original images and every unpublished recreation.
- Version delete removes one recreation and keeps the source and other versions.
- Submitted, reserved, published, digest-reserved and in-progress render or publish work is rejected with 409. Publication identities stay.
- Exclusive private images, videos and render previews are marked for the existing cleanup pass. Files still referenced by another source stay.
- After a source delete, the same owner and import source may import that external ID again. The new row gets a new source ID.
- Delete is available on the page and the project REST API. MCP write tools do not expose it.

## Files changed

- `factory-cloud/src/psychology-video-hit-cleanup.js`
- `factory-cloud/src/factory-api-catalog.js`
- `factory-cloud/src/psychology-video-hits.js`
- `public/psychology-video-hits.html`
- `public/psychology-video-hits.js`
- `public/psychology-video-hit-ready.js`
- `public/psychology-video-hits.css`
- `docs/psychology-video-hits-api.md`

## Tests performed

- Cleanup and gateway tests cover unpublished deletion, replay, published refusal, shared files, digest reservation, member boundaries and re-import.
- The video-hits browser test deletes a source from the list and hides delete on published versions.

## Unfinished work

- None.

## Recommended next step

- Use the delete button on unpublished imports. Published records still need the existing archive and 24-hour cleanup path.
