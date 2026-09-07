# Factory archive business scope and refresh — 2026-09-07

## Goal
Accept analytics only for explicitly linked factory business accounts and refresh local copies every two hours.

## Decisions
- New authenticated GET /api/integrations/signal-desk/archive-scope returns canonical account keys from current assignment table plus existing groups/projects. Empty or removed assignments cannot revive legacy KV grants.
- Push receiver and pull ingestion independently filter against live membership. Account directory, archive accounts and per-account video loaders also filter membership, hiding previously stored unrelated accounts without deleting historical files.
- New-account discovery on refresh uses desk's owner-restricted identity directory; unassigned accounts are not persisted as analytics archives.
- Local official-analytics-archive polls stored desk data every two hours, prevents overlapping runs and skips duplicate runs within two hours. Daily snapshot granularity is unchanged. This does not change publish-status synchronization.

## Files
scripts/factory-archive-scope.js and tests; scripts/official-analytics-archive.js and tests; factory-cloud/src/factory-archive-scope.js, factory-storage.js, official-archive-store.js, official.js; factory-cloud/package.json.

## Validation
224 factory tests passed, including real unauthorized scope requests, empty/revoked membership refusing customer writes, and same-day local refresh after two hours. No live publishing tests.

## Unfinished work
Not deployed or restarted. Work is isolated on codex/scoped-factory-sync because the primary checkout has unrelated in-progress edits. Requires matching desk changes. No destructive purge of older archives; filtering prevents normal scoped use and further ingestion. Read real production scope counts after deployment to confirm existing business assignments are canonical.

## Next step
Integrate the isolated commit into clean GitHub main when concurrent work is settled. Deploy factory-cloud FIRST using npm run deploy, then deploy matching desk using npm run cloudflare:deploy. Apply local timer code and restart only while no active jobs will be interrupted.
