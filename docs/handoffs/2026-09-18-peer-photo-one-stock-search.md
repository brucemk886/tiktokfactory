# Goal

Stop peer photo recreation from calling Pexels once per stock page.

# Decisions

- One empty-scene Pexels search covers every page that needs a background.
- Filtered stills are assigned in order, one unused image per stock page.
- Per-page DeepSeek stock picking is removed.

# Files changed

- `factory-cloud/src/peer-photo-workflow.js`
- `factory-cloud/src/psychology-peer-production.test.js`
- `public/psychology-peer-production.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-peer-production.test.js`

# Unfinished work

None.

# Recommended next step

None.
