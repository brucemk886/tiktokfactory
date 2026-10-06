# Branded psychology receiver short links

## Goal
Replace long homepage UTM links with fixed short links under deeppersonaai.com while retaining receiver attribution and measuring link visits.

## Decisions
- Use /go/ plus a random 10-character code. Mappings are persisted and unique per project/account; existing codes are never rotated on refresh or repeated creation.
- Explicit owner-only creation via POST /api/psychology-website/links. Analytics GET and unified read API remain read-only.
- Factory owns mappings and daily aggregate counters; DeepPersona delegates only /go/ requests through a service binding. Destination is fixed to the current site home page, preserving existing utm_source, medium and factory-account campaign.
- Count requests after short-link creation, with basic known bot/prefetch exclusions, no customer identifiers and no promise of unique or complete TikTok clicks. HEAD does not count; counter failure cannot stop a redirect.
- Existing long URLs, profile settings, campaign readiness, content and publishing queues are unchanged.

## Files changed
Factory migration 0077, psychology-website-links module/tests, website handler/UI/tests, public route wiring, static asset manifest, test command and architecture/current-state docs.
DeepPersona worker short-link adapter/tests and FACTORY_LINKS service binding.

## Tests performed
17 focused factory/backend/browser tests passed. DeepPersona TypeScript validation, production build and all 78 tests passed. Full factory regression: 1,245 passed, no failures or skips. Production verification is recorded in the task result.

## Unfinished work
Historical click counts cannot be reconstructed. Owners must place each generated link on the correct profile and separately confirm receiver readiness. Basic bot exclusions are not human or unique-visitor verification.

## Recommended next step
Deploy Factory first, then the branded site adapter, create current eligible receiver links through the authenticated UI and verify no-count HEAD redirects plus reporting.
