# Grokbot rewrite quality gate

## Goal
The 2026-09-23 Grokbot import produced template rewrites (five fixed title patterns with one topic word swapped, identical body lines on every post, garbled original lines pasted into checklists, empty captions, hashtags on image pages). Remove them and stop it from happening again.

## Decisions
- Soft-deleted all 990 live `grok-*` rewrites on production (`enabled=0, deleted_at=now`). Tombstones stay, so a resubmitted identical version is a duplicate, not a new row. 84 non-Grokbot versions were left alone.
- New `factory-cloud/src/psychology-rewrite-quality.js`, applied only to the peer-hits write path (manual versions unchanged). Any failing version rejects the whole request with post / rewrite / page / reason:
  - caption required, at least 20 characters once hashtags are removed; title without hashtags; pages 2–6;
  - no hashtags, links or "link in bio" on image pages; no page copying a submitted original page verbatim; splice artifacts such as "Do they You"; English only;
  - no page (20+ chars, case-insensitive) identical to another post's rewrite in the same request or anywhere in the library, deleted versions included.
- Docs: `docs/psychology-peer-hits-api.md` gains 写入标准与改写规则 (original-text standard, rewrite rules, rejection table, a pasteable English instruction). Examples no longer use an empty caption. The copy library's 写入接口 panel shows the rules and has a button that copies the instruction.

## Tests
Factory suite 642/642, including a gate test built from real template lines. Fixtures of other suites updated only where their deliberately minimal captions now fail the gate.

## Not done
- Original `pageTexts` quality (garbled OCR, off-topic posts such as Monster High) is only a documented rule; nothing checks it automatically. An audit of the 382 photo originals is still open.
- Group C (rewrite first) of the autopilot has no usable rewrites until Grokbot resubmits under the new rules.
