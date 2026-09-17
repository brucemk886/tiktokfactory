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
- `git diff --check` passed.

## Unfinished work

- Commit, push, deploy, and verify the header controls online.

## Recommended next step

- Keep future secondary page actions in the same header tool group instead of adding full-width panels above the list.
