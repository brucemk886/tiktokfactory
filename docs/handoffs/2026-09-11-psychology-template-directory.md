# Psychology template navigation

## Goal
Move psychology templates out of online mid-video and expose three independent entries under Psychology.

## Decisions
- Existing /psychology is labeled Four-image test (四图测试模板), with unchanged topic links, settings and task behavior.
- Paper collage (/psychology-collage) and Interactive test (/psychology-target-2) have separate admin entries under Psychology. Existing admin sessions receive the separated entries through the existing sidebar normalization; operator permissions remain unchanged.
- Removed psychology cards from the mid-video workbench and corrected titles and the legacy /psychology-narrative navigation highlight.
- Added the existing psychology-target-2 task type to Psychology's recent-video classification.
- Local service processes, worker queues, job IDs and stored configuration are untouched. The local sidebar catalog is unchanged; this request targets the online factory.

## Files changed
factory-cloud/src/sidebar.js, auth.js, jobs.js and related tests; public/access.js, hub.js, mid-video.html and the three psychology template HTML pages; docs/CURRENT_STATE.md.

## Validation
33 focused tests and all 237 online factory tests passed. An isolated browser with mocked authentication verified the three template titles/entries, active Psychology group, old interactive-test URL and absence of psychology cards in mid-video. No live generation or publishing APIs were called.

## Remaining / next step
Deploy the exact committed main revision using factory-cloud/npm run deploy and check the online service. Original working directory has unrelated pending work and must not be included in this release.
