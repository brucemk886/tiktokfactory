# Goal

Replace blank-line copy splitting with one labeled input per image, so later 图文爆款 recreation can fill those fields directly.

# Decisions

- Count controls how many copy boxes appear. Newlines stay on that image.
- Stock still has optional title/subtitle on the first image only.
- Text content pages use the same one-box-per-page pattern; cover stays a single quote.
- Recreation routing across AI / stock / text templates is not implemented yet.

# Files changed

- `public/psychology-photo.html`
- `public/psychology-photo.js`
- `public/psychology-photo.css`
- `public/psychology-text-card.js`
- `factory-cloud/src/psychology-module.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-module.test.js`

# Unfinished work

- 图文爆款 复刻: detect which of the three templates to use, then fill per-image copy boxes and recreate image plus copy.

# Recommended next step

Use the live photo template with count=3 and confirm three separate copy boxes appear in all three modes.
