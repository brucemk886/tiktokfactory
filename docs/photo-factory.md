# Photo factory: independent trial module

The photo-only factory is available at `/photo-factory`. Existing psychology/photo/video automation is not migrated. Only shared stateless card renderers, official account authorization, Signal Desk transport and local video observations are reused.

## First use

1. Create a direction from the Zodiac, Psychology, MBTI, Relationships or Fiction-excerpt preset, or define one. All presets are editable. Default output is 9:16, 1–6 text pages.
2. Add or import copy into that direction. AI rewrites use the direction model (default Claude Sonnet 5) and remain disabled until reviewed/enabled.
3. Preview/download cards in the template workbench. Preview is local browser rendering and creates no publishing jobs.
4. Use newly assigned test groups in official account management. Existing psychology pilots (active or paused and not expired), their accounts, and outstanding psychology schedules block overlap.
5. Select multiple groups, configure a common strategy with per-group times and offsets, and create drafts. Explicitly start each draft to run it. Pause/end stops not-yet-submitting work; submitted or ambiguous submissions continue receipt reconciliation. Resume never recreates stopped slots.

A direction includes language, audience, tags, rewrite rules, structure, model, aspect, page/character bounds and allowed styles. It has an optimistic revision. Every execution freezes direction revision/config, copy body/model, group, account and style. Source/input format is independent of photo output; imports must contain already-extracted text pages. Fiction in this version means independent excerpts, not sequential chapters.

## External copy API

Generate a direction-specific key in Content directions. The raw token is shown once; only its SHA-256 hash is stored. Rotation invalidates the old key and revocation disables it. Keys cannot create/start pilots or publish.

`GET /api/integrations/photo-factory/copies`

With `Authorization: Bearer <direction-key>`, returns that direction's ID, revision, configuration and allowed tags. A supplied directionId never overrides key scope.

`POST /api/integrations/photo-factory/copies`

```json
{
  "items": [
    {
      "externalId": "source-001",
      "kind": "original",
      "title": "A specific hook",
      "caption": "A relevant caption",
      "pages": ["Cover text", "First idea", "Closing thought"],
      "tags": ["virgo"],
      "metadata": {
        "sourceUrl": "https://www.tiktok.com/@example/photo/123",
        "accountName": "example",
        "views": 12000,
        "likes": 500,
        "saves": 80,
        "shares": 30
      }
    }
  ]
}
```

At most 50 items per call. Returns per-item `{ok,id,duplicate}` or `{ok:false,externalId,error}`. Repeating an externalId with identical title/caption/body/kind returns its existing ID. Conflicting body content returns an item error; originals are not silently overwritten. A rewrite uses `kind: "rewrite"`, `sourceId` from an original in the same direction, a distinct externalId, optional `model` and `enabled`. Use `enabled:false` to request review first. Metadata is retained for reference and is not used as own-published performance.

## Execution and observations

- New tables use `photo_` prefixes; there are no writes into psychology content, pilots, items or factory_jobs. New official records use `photo-factory:` IDs.
- Dedicated `PHOTO_FACTORY_WORKFLOW` binding, `factory-photo-content` workflow. Minute dispatcher plans at most 100 new items/tick and permits at most 2 new-factory rendering workflows concurrently. Single test group <=100 accounts. These are conservative trial limits, not a throughput guarantee.
- Starts preparing two hours before target time; a newly activated slot needs >=10 minutes lead. Late preparation beyond 5 minutes after scheduled time fails without making an initial submission. Account times are staggered; same-account configured slots are at least 30 minutes apart, including midnight.
- A rotates originals/rewrites in cold exploration and uses ~70% mature-score priority / ~30% untested priority after data arrives. B originals only; C enabled rewrites only. Each unjudged version has at most three occupied samples. A source can be selected only once per direction/account across originals and rewrites. Content shortage creates no partial slot.
- D1 slot/source reservations and immutable requests prevent duplicate schedule/submission. A retry replays the same externalId and frozen request. Submission success is `submitted`; only the exact official task receipt can mark `published`. Missing video IDs remain visibly missing and are rechecked.
- JPEGs are privately stored under `photo-factory/<jobId>/` before upload. Completed/failed/stopped backups are removed after seven days; content/schedule/receipt history remains.
- Report reads use local `ops_video_facts` joined by exact account/video identity, never a live TikTok request. Execution date is scheduled time; effects use actual publication date and latest cumulative observations. Zero views count as a sample; missing views do not. Existing sync coverage/frequency determines freshness.
- This is a parallel test release. Switching the existing psychology experiment to the new module requires the user's later migration decision.
