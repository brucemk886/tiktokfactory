# Goal
Make the template-to-many-topics structure visible, with existing questions, per-topic reveal comments and create/edit/delete actions.

# Decisions
- Topic bank landing shows three cards with total/enabled/unused counts. Each opens a separate list via ?template=psychology, psychology-collage or psychology-target-2. Refresh and browser history retain the selected bank; switching banks resets filters.
- Admin workbench cards 01–03 open those lists when topic-bank permission is present. Direct rendering tools remain available below; other users keep their previous rendering entries.
- Lists expose each question's own reveal comment, safely escaped and expandable. Create/edit/delete continue using the existing revision-protected APIs and do not change existing publishing snapshots. A new question clears filters so it is visible after saving.
- Timed-comment settings link to the selected bank, and each bank links back to its own template settings.

# Files changed
public/psychology-topic-bank.{html,js,css}; public/psychology-templates.html; public/access.js; public/psychology-comments.{html,js}; docs/CURRENT_STATE.md.

# Tests performed
- 55 related topic-bank, psychology-module, scheduled-comment, local-auth and auto-publish UI tests passed.
- Isolated Chrome QA: three banks and counts, separate lists, create/edit/delete, answer expansion, refresh/deep links/browser history, settings round trip, 390px mobile overview with no overflow, no page errors.
- Real access.js with mocked sessions: admin cards route to the matching bank, operator rendering routes remain unchanged. No production data was created/deleted by tests.
- Desktop screenshot inspected. QA commands: node work/qa-topic-bank.mjs and node work/qa-topic-workbench.mjs (ignored local QA fixtures).

# Unfinished work
Deployment and production smoke results are reported in the task response.

# Recommended next step
Open 模板题库, select a template and manage its questions and reveal comments. Existing stored questions are read through the same template-scoped API.
