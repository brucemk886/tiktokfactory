# Photo generation reliability audit

## Goal
Read-only investigation of historical preparation failures and remaining risks in current copy-library photo production.

## Verified evidence
- Production D1: seven photo batches, all sourceType=peer, latest September 22. No production batch using the new library source was present at query time.
- 27 persisted preparation errors: 23 legacy analysis internal errors, 1 analysis timeout at 120000ms, original image downloads HTTP403 and HTTP520 (one each), 1 Pexels search failure.
- Legacy item with '请填写内容标题或文案。' failed in card construction: exact error originates only from public/psychology-text-card.js. Cloud rendering failures pass through finishPsychologyPublishAttempt and store a generic failed official record; psychologyItemStatus then prioritizes that record as publish_failed. Rendering vs publishing classification remains a defect; no TikTok rejection can be inferred from this error.
- Current library source supplies copyVariant and forbids rewriteCopy=true; workflow skips source image resolution, AI extraction/rewrite, and Pexels for these text scenes.
- Production copy data: 400 completed photo originals, 1647 stored pages, 14 pages over1500 chars, 1 empty page. 84 enabled nondeleted rewrites have nonempty title/caption and <=6 pages.
- Offline validation with current HEAD 9227b9a page filtering: 395 usable originals; 44 originals lose a total49 pages, including5 with no remaining page;1598 retained pages. This is latest-code validation, not proof that that concurrent page-filter commit was already deployed (last observed deployment preceded it). Options still reports400 raw done records.

## Remaining risks
- Raw source total differs from usable pool and per-account unused capacity. Query and deduplication reduce available choices further.
- Original filtering (>500 chars or no two consecutive letters) can remove whole pages, requiring visual/content review. Structural validity does not validate semantic quality.
- Styled canvas shrinks text to16px then throws when a page still cannot fit. There is no automatic alternate-style retry.
- Cloud browser launch retries3 attempts, then cloud job retries twice30/60sec; upload uses per-page checkpoints and wave concurrency3; group size20, consumer concurrency20. Service/network failures can still exhaust retries.
- Authorization expiry/account bans and downstream publishing rejection remain separate from generation quality. Existing group isolation mitigates siblings being blocked; transient waiting may remain until reconciliation.

## Validation and changes
- 77 focused tests passed (cloud queue, copy evolution, auto-publish); hub/browser calls mocked.
- No live generation, upload, publication, retries or data mutations. No runtime code edited.
- Sanitized findings only; full source-copy read held in task-host TEMP, not Git.

## Recommended next step
Align visible counts with usable content, separate render/upload/publish error phases, then validate a small real library batch before scaling. Actual publication requires user instruction.
