# Agent Skills review flow

Scope: import, inspect, approve, assign and export Agent Skills in the Windows desktop app. Existing drawer, buttons, select and checkbox styles are reused.

The packaged E2E imports a real folder, inspects a script as text, verifies assignment is refused before review, confirms the explicit review action and exports all resources plus the Orglet manifest. It then imports a package declaring Bash and verifies activation is disabled with a repair message. It covers narrow layout and absence of renderer exceptions. Native folder dialogs are stubbed only in E2E.

Computer use separately operated the packaged Windows window: opened the file dropdown, selected the packaged script, observed its text and disabled review controls, then used the real Windows directory picker to import the exported package. The new import required a fresh checkbox confirmation; clicking Confirm closed the review panel. No packaged script or model API ran.

Native inspection found indistinguishable names in the library and a checkbox laid out above its label. Library items now include the package identity and local review status; the checkbox uses the existing horizontal check-row style. Import failures are displayed inside the library drawer so they are not hidden behind its modal overlay. These final adjustments are covered by the packaged smoke's layout and status assertions.

The preview is a labelled, read-only textarea; Markdown/HTML and scripts are not rendered or executed. Binary files have an explicit preservation-only message. Unsupported capabilities have a textual reason and disabled activation controls. Full screen-reader navigation, every contrast state and installer execution were not tested in this flow.
