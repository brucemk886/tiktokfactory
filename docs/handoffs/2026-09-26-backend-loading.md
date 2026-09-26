# Backend navigation performance

## Goal
Reduce shared navigation overhead without caching authorization or changing running publishing jobs.

## Findings before change
Browser capture on the same profile: psychology-publish FCP 2752 ms, load 5539 ms; copy library FCP 2904 ms, load 7099 ms. CSS/JS revalidation commonly >1 second. Index invoked handleAuth/getSession before static assets and invoked getSession again; each valid session used two sequential D1 reads. Browser navigation identity additionally loaded unused GeeLark profiles. Publish navigation fetched account directory and creation options eagerly.

## Changes
- Tracked root JS/CSS and Bootstrap SVG icons have an explicit generated allowlist; GET/HEAD serves through ASSETS before auth, with zero D1 reads. No HTML, API, uploads, JSON or runtime artifacts in this allowlist.
- Streaming HTMLRewriter adds content-version query parameters to same-origin scripts/styles/icons. Matching versions cache immutable for one year. Unversioned/stale-version URLs revalidate, errors/wrong MIME do not cache. Private HTML remains no-store and conditional page requests cannot reuse an old unversioned shell. HTML permissions are checked on GET and HEAD; other page methods return405.
- handleAuth reads identity only for auth/me. Ordinary requests check identity once, with current revocation/expiry. Navigation view omits unused profiles; original full auth/me contract remains supported.
- Publish page loads only current batch list at startup; local scoped handles and static template labels accompany it. Creation accounts/options load on dialog open, coalesce overlapping opens, and preserve successful data while failed loads can retry. No TikTok read or publication is added to list loading.

## Files / release maintenance
factory-cloud/src/ui-assets.js, ui-asset-manifest.js, ui-assets.test.js; scripts/ui-asset-manifest.mjs; auth.js/index.js; psychology-auto-publish service/test; public/access.js and psychology-auto-publish.js; UI tests/package.json.
After changing tracked frontend JS/CSS/icons run `npm run assets:manifest --prefix factory-cloud` and commit the generated manifest. Deployment refuses stale manifests. No migration required.

## Tests
814 full factory tests passed, including static zero-query access, errors/cache versions, fresh authorization/revocation, protected HTML/HEAD, local nickname scope, deferred creation reads and existing publishing/regression tests. Baseline browser capture stored under ignored work/backend-navigation-slow-20260926.json. Release and post-release timing results are recorded in task output.

## Remaining
Observe actual post-release browser timings; network and individual business-query latency are still separate from public static serving. Existing queued/running work remains untouched.
