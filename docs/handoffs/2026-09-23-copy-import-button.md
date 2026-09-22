# Copy library bulk import button

Goal: replace the bulk-import tab with a top-right button.

Changes: removed both redundant top tabs; added the 批量导入 header button, retained all-version dialog and source-specific rewrite details, and automatically expanded the import form for bulk mode. Legacy #copies links still open the dialog. Removed unused tab styles. No API/data changes.

Files: public/psychology-copy-library.html, .js, .css; docs/psychology-photo-creative.md.

Validation: 576 factory tests passed. Isolated desktop/mobile Chrome smoke passed button opening, expanded bulk form, independent per-source details and no script errors. Desktop screenshot inspected; no real data written.

Next: commit/push main, deploy through npm run deploy, verify live header. No unfinished implementation.
