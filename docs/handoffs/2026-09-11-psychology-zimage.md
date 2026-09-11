# Psychology Z-Image and topic-library removal

## Goal
Remove the online psychology topic-library feature and switch all three psychology templates to Z-Image.

## Decisions
- Removed the online sidebar entry, fallback navigation links and four-image template's topic fetch/selection flow. Manual question, narration and image-prompt entry remain available; the configured video count now applies to manual creation. Old topic-page URLs redirect to the four-image template; retired topic APIs return 410. Existing stored records are not deleted.
- Added a shared psychology-only image policy at queue creation, worker payload delivery and each standalone generation job entry point. Stale scalar/list model values are overridden; other business generators keep their existing models.
- Settings GET/POST and frontend submissions use Z-Image. Nano Banana and Grok controls were removed from all psychology templates. Existing voice, duration, layout, task and publishing settings are preserved.
- Already executing jobs/processes are not stopped. Cloud payload enforcement also works for workers still running their previous checkout.

## Files
scripts/psychology-image-policy.js; the three psychology job entry points and related tests; factory-cloud jobs, compat, routing, auth/sidebar, test command and module tests; psychology frontend pages/scripts and obsolete fallback topic links; CURRENT_STATE.md.

## Verification
254 full factory tests passed. Browser test ran actual frontend scripts with mocked APIs: all three submit Z-Image despite old model settings; manual four-image topic/count submission works; no topic-library API requests or browser exceptions. Tests did not call real image generation, TTS or publishing APIs.

## Release outcome
Released together with the psychology peer-hit module on 2026-09-11 after the user explicitly requested “上线”. Runtime commit `270716a391700e2635b3aafac2db22b377dacdcb`; Cloudflare version `2d3ad1c2-9739-46e9-8c29-be4115c750b7`. The combined test suite passed all 261 tests. Live browser verification confirmed Z-Image on all three psychology templates and no topic-library sidebar entry. Original checkout and running workers were preserved. See `2026-09-11-psychology-peer-hits.md` for release details.
