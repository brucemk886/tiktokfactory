# Psychology peer-hit header actions

## Goal

Move the write and manual-add controls into the top-right header and simplify the visible integration label.

## Decisions

- The header now shows `写入接口`, `手动添加视频/图文`, and `刷新列表` together.
- Each action opens a dropdown panel beneath its button; opening one closes the other.
- The visible integration label is `写入接口`; grokbot remains named inside the explanatory content where it describes the actual writer.
- Mobile dropdowns span the available viewport width below the wrapped header controls.

## Files changed

- Peer-hit HTML, CSS, browser behavior, page assertions, and API usage documentation.

## Tests performed

- `node --test src/psychology-peer-hits.test.js` — 10 passed.
- `node --check public/psychology-peer-hits.js` passed.
- `git diff --check` passed.
- Production deployment from commit `fed13e7` succeeded as Worker version `8af8abd3-a597-423b-9d00-1dce74278035`; all three changed static assets uploaded.
- Automated visual screenshot verification was unavailable because the local browser-skill CLI and extension protocols are mismatched; both bounded sessions were stopped and no production data was changed.

## Unfinished work

- None in code or deployment. A human visual check can confirm spacing until the browser-skill versions are aligned.

## Recommended next step

- Keep future secondary page actions in the same header tool group instead of adding full-width panels above the list.
