# Goal

Match peer photo covers more closely and keep content pages readable.

# Decisions

- Cover and content use two separate Pexels searches.
- Cover queries keep people/couples and use the original cover scene.
- Content queries prefer bright airy empty skies.
- Overlay text keeps normal spaces and wraps on words; paragraph spacing sits after each sentence.
- Covers anchor near the top with larger type over a soft white scrim.

# Files changed

- `factory-cloud/src/peer-photo-workflow.js`
- `factory-cloud/src/photo-publishing.js`
- `scripts/psychology-peer-production.js`
- `public/psychology-text-card.js`
- `public/psychology-card-renderer.js`
- `public/psychology-photo.js`
- `public/psychology-peer-production.js`
- `factory-cloud/src/psychology-peer-production.test.js`
- `factory-cloud/src/psychology-module.test.js`
- `docs/CURRENT_STATE.md`
- `docs/psychology-peer-hits-api.md`

# Tests performed

- `node --test factory-cloud/src/psychology-peer-production.test.js factory-cloud/src/psychology-module.test.js`

# Unfinished work

None.

# Recommended next step

None.
