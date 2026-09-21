# Team template interface review

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/template-ui-review-dark.png">
  <img src="images/orglets/template-ui-review-light.png" alt="" width="112" height="112" align="right">
</picture>

Scope: import/export controls in the existing TeamEditor drawer. No layout or visual-system redesign.

Native computer use opened a saved team, scrolled to export, saved through Windows Save, opened Create team, selected the file through Windows Open and observed a new team. The export success status was visible; closing the drawer restored focus to its trigger. The imported team kept its name, so identical names can appear; identity and configuration remain separate.

Buttons have accessible names and use existing styles. Export says it uses saved configuration; the adjacent explanation describes included data and exclusions. Status uses a live region, errors use an alert, and file operations disable submit/import/export while pending. Drawer content scrolls within its existing bounds. Existing typography and color tokens are unchanged; no separate contrast audit was performed.

Packaged E2E also verifies preserved preflight settings, fresh member IDs and no automatic task creation. Invalid-template and atomicity checks are covered in core integration tests. No actionable interface finding remains within this narrow scope.
