# 心理学发布记录: merge 发布对标 and 爆款复刻

## Goal
One psychology page for "what was published, where, from which copy, and how it was made", replacing the separate 发布对标 and 爆款复刻 pages.

## Decisions
- /psychology-publish-sources is renamed 心理学发布记录 with two views. 自动发布 (default) is the per-post table; 手动复刻 is the old board limited to manual 原帖复刻 jobs.
- Each auto row can open 制作详情, a dialog that reuses the board renderer through `window.psychologyProductionDetail`; delete buttons are stripped there. The analysis job keeps the item's own id, so the dialog reads `item.id`.
- The list no longer depends on factory_jobs for identity: title, peer URL and source kind come from psychology_peer_hits / psychology_copy_variants (peer resolved via `v1:tiktok:<id>` → video_id) / psychology_template_topics and the batch config. Status prefers the official publish record (published / publish_failed); rows whose job was pruned show 任务已清理. Search also covers those durable titles and links.
- Production API gains `origin=manual`; deleting an auto-publish job from the board is refused (409) so a batch cannot be stranded.
- 爆款复刻 stays as a hidden module id (`navigationParent`) so saved grants keep working; either grant opens the merged page. /psychology-production(.html) redirects to `?view=manual`, preserving `job`. Internal links updated.
- Context: on 2026-09-23 the operator manually cleared factory_jobs, leaving all 143 psychology items without jobs. That is why durability mattered; no data was recreated.

## Files changed
factory-cloud/src/psychology-auto-publish.js, psychology-peer-production.js, sidebar.js, index.js; public/psychology-publish-sources.{html,js,css}, psychology-production.{html,js}, psychology-peer-production.js, psychology-copy-library.html, psychology-auto-publish.html, psychology-topic-bank.html; tests in psychology-auto-publish / psychology-peer-production / psychology-copy-library; docs/CURRENT_STATE.md.

## Tests
Full factory suite 586/586. New: records keep peer links, titles, source kind and official outcome after factory_jobs is cleared, and search still finds them; manual view excludes auto jobs, the dialog can still read one, and deleting it returns 409; old board URLs redirect with the job kept; either grant opens the page, operators stay out. `node --check` on changed browser scripts.

## Unfinished / next
No browser tool was available, so the merged page was not visually checked; verify both views and the 制作详情 dialog after deployment. Existing rows from before the cleanup will show 任务已清理 with no production detail.
