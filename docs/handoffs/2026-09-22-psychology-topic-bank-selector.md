# Goal
Expose a concrete template topic bank selector in psychology video automatic publishing.

# Decisions
- Video + template-bank source shows all three named banks with enabled/total counts and a direct manage-topics link.
- Bank and render template synchronize in both directions. The existing config.template remains the single backend extraction key; mismatched UI values cannot submit.
- Peer and photo workflows hide the selector. Existing topic permissions, enabled/unused filtering, selection rules and insufficient-source checks remain in force.
- No topics enabled and no real publishing tasks created for validation.

# Files changed
public/psychology-auto-publish.html; public/psychology-auto-publish.js; scripts/psychology-auto-publish-ui.test.js.

# Tests
11 UI regressions including all three bank submission payloads, counts, template sync, permission and media/source switching. Factory full suite: 524 passed; JavaScript syntax check passed.

# Next step
Push main and deploy from a clean main checkout, then verify live selector transitions without submitting a batch. Deployment outcome is reported in the task response.


# Follow-up: remove duplicate template control
The template-bank source now hides the redundant generation-template field; the selected bank still supplies the matching renderer. Peer video and photo sources retain the template field. Existing switching regression covers visibility in both modes.
