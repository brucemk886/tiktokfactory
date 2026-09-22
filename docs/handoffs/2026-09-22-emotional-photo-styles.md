# Goal
Keep the seven preferred psychology photo styles and replace the other thirteen with relationship/emotion-oriented layouts.

# Decisions
- Retained classic, editorial, night, letter, dialogue, quote and minimal unchanged.
- Added unsent, inner-voice, soft-space, midnight-letter, soft-boundary, reassurance, relationship-journal, confession, emotional-echo, after-talk, intimacy-distance, reconnection and slow-closeness. Cover/body layouts use quieter letter, dialogue, boundary, distance and reconnection motifs.
- Active gallery and default assignment expose exactly twenty styles. New IDs prevent changing historical meanings; old thirteen IDs remain archived for frozen rendering and report labels.
- Existing stored group/account pools resolve their old IDs to replacements for future creation. Binding API returns current IDs and normalizes saved legacy selections. No running job is edited and no database rewrite is required.

# Files
public/psychology-visual-styles.js, public/psychology-styled-card.js, public/psychology-creative.html, factory-cloud/src/psychology-creative.js and its tests.

# Validation
550 factory tests passed, including retained styles, archived legacy IDs, old fixed/group selection replacement and unchanged frozen tasks. Production cloud module loader rendered forty cover/body cards and twenty long-copy cards using local headless Chromium. Contact sheet visually checked; syntax and diff checks passed. No external publishing calls.

# Next step
Ship committed main with the standard factory deploy command; verify the hosted gallery has the twenty emotional styles and omits retired styles. No unfinished implementation work.
