# Factory API image reads

## Goal
Let the project API credential read the topic-card and video-hit frame image URLs returned by `/api/v1/factory`.

## Decisions
- Accept the existing `fac_api_` bearer on GET (and HEAD for frame files) of those private image URLs. Do not publish the objects or add a separate image scope.
- Anonymous and invalid keys stay 401. A valid key whose administrator lacks the topic-bank or video-hit module stays 403. Frame reads keep the existing owner/admin asset scope.
- Session-cookie reads for logged-in pages stay unchanged. Uploads on the session path still require a login.

## Files changed
- factory-cloud/src/index.js, factory-api.js, factory-api-catalog.js
- factory-cloud/src/psychology-topic-bank.js, psychology-video-hit-assets.js
- factory-cloud/src/factory-api.test.js, psychology-video-hits.test.js
- docs/FACTORY_API.md, docs/CURRENT_STATE.md

## Tests performed
- Focused factory API and video-hit tests cover authorized reads, anonymous 401, invalid keys, missing module 403, and session upload rejection.

## Unfinished work
None for this request.

## Recommended next step
After release, retry the same project key against a returned topic-card or frame image URL.
