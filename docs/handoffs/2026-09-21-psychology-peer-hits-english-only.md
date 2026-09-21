# 心理学同行爆款只保留英语

## Goal
Delete non-English psychology peer hits and stop grokbot from writing them back.

## Decisions
- Keep English posts, including hashtag-only captions and grokbot Chinese glosses after `|` or `/`.
- Skip Indonesian, Malay, Filipino, Thai, Vietnamese, and Chinese body copy, plus explicit non-`en` `videoData.language` tags.
- Mixed grokbot batches skip non-English items instead of failing the whole request.

## Files changed
- `scripts/psychology-peer-language.js`
- `scripts/psychology-peer-language.test.js`
- `factory-cloud/src/psychology-peer-hits-store.js`
- `factory-cloud/src/psychology-peer-hits.test.js`
- `docs/psychology-peer-hits-api.md`
- `docs/CURRENT_STATE.md`

## Tests performed
- `node --test scripts/psychology-peer-language.test.js factory-cloud/src/psychology-peer-hits.test.js`

## Unfinished work
None. Live D1 now has 223 English psychology peer hits (199 photo / 24 video). One English video titled "Overthinkers biggest problem..." was removed by an overly strict first pass and should return on the next grokbot crawl.

## Recommended next step
None.
