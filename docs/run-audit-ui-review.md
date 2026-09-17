# Run-log audit UI review

The source drawer reuses the existing dataset selector, native select, buttons and checker history. Users select exactly one dataset and explicitly choose the metric direction. Missing direction, multiple selections and revoked sources disable the run action. Trusted input errors explain the required columns inside the drawer.

The packaged E2E attaches two CSV fixtures through the UI, checks disabled states, submits a malformed log, verifies the column error and confirms no partial checker result was saved. It then runs a 61-row log: 60 completed observations, one failure whose score is excluded, zero within-group sample deviation, and a public 15 → private 1 change of +14. The fixture tests error-code disclosure, rank rows and narrow overflow.

Native computer use separately clicked the run action in the Windows app, observed a second saved result and opened it. The visible summary correctly showed 60 completed, one failed and one excluded failure score. The original expanded group table made rank information difficult to reach. The tables now use separate disclosure controls, and saved results follow both checker actions. Final E2E covers those controls. Native execution did not call a model API or execute downloaded code.

Status copy describes observations, insufficient evidence or failures needing review. It never calls the challenge stable or approved from these descriptive statistics. Full screen-reader testing, exhaustive contrast checks and installer execution were not part of this review.
The final layout was also checked with native computer use: opening the rank disclosure showed the table directly, and scrolling it showed s14 with public 15, private 1 and +14.
