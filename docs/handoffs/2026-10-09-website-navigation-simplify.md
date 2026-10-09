# Independent website navigation consolidation

## Goal
Remove unnecessary tab switching and repeated account statistics from Independent Website.

## Decisions
- Reduce navigation to 转化概览 / 成交订单 / 引流配置. Overview retains the per-account funnel and selector; remove the separate aggregate account table. Detailed source/campaign attribution is a collapsed section in overview, preserving its Beijing date semantics and paging.
- Combine receiver/CTA settings and expandable homepage tracking links in 引流配置. Link statistics remain in overview; configuration displays only generation/copy controls and account status. Saved CTA/account forms and drafts remain independent.
- Link retrieval remains lazy when configuration is opened directly. Analytics/link failures show within the link section without blocking receiving settings. Scope settings-save controls to their own form so unrelated link controls are not reset.
- Existing sources deep links open overview with source details expanded; links deep links open configuration with links expanded; receiving links stay valid. Keyboard navigation and responsive segmented presentation are preserved.
- No API, permissions, attribution calculations or publishing behavior changes.

## Files changed
- public/psychology-website.html/js/css and psychology-website-receiving.js.
- Both website browser regression files; generated UI manifest; canonical/generated API guide; CURRENT_STATE and this handoff.

## Tests performed
- Full-style Chromium checks at 1366/390/320 px cover the three exclusive panels, no duplicate account table, fold defaults, source pagination, link generation, legacy deep links and keyboard navigation.
- Receiving settings tests cover independent saves/drafts and verify failed link retrieval leaves CTA editing available.
- Desktop/mobile screenshots inspected under ignored tmp/website-tabs-qa. Final focused checks and deployment evidence pending.

## Unfinished work
Deployment verification pending.

## Recommended next step
Refresh Independent Website. Use overview for performance and traffic configuration for links/accounts/CTA.
