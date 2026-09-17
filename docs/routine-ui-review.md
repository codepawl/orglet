# Routine and shift interface review

| Field | Scope |
| --- | --- |
| Target | Current routine/shift edits in the uncommitted workspace |
| Base/head | No committed base; earlier source and rendered captures provide the comparison |
| Source surfaces | RoutinesPanel, TeamEditor, TaskThread and their App entry points |
| Excluded | Generated bundles, binaries, lockfile and unrelated screens |

| Domain | Evidence | Coverage |
| --- | --- | --- |
| Accessibility | Native time/select/checkbox controls, UIA names, keyboard selection, visible focus, Escape restoration, inline timezone/approval errors | Inspected; no full screen-reader certification |
| Layout | Routine list/editor at 1200×820 and 780×640, sidebar actions and handoff disclosure | Controls remain reachable through visible scrolling |
| Writing | Recurring permission, missed-run action, config/source changes, shift stop, error recovery | Invalid timezone now names the failed field and examples |
| Typography | Existing inherited styles; long permission text wraps in drawer | No type-system changes or separate type audit |
| Color | Existing monochrome tokens, explicit text states | No new color tokens; no separate contrast measurement |
| UI polish | Reused controls and disclosure | No separate animation or visual-system changes |

Introduced issue resolved: invalid timezone originally returned only a generic error. The form now provides an inline explanation, associates it with the input and focuses that input. Missing recurring approval also focuses its checkbox. Native inspection also found indistinguishable handoff messages from two paused roles; generated blockers now name their role and use the latest run for each role.

Verification: packaged E2E creates a schedule, waits for an actual timed demo, observes an overdue occurrence after restart, explicitly runs one catch-up, saves shift/concurrency settings and opens a genuine shift handoff. It checks outside-shift resume rejection and narrow layout. Native computer use changes the schedule to weekly, corrects a bad timezone, observes approval reset, saves/disables the schedule and toggles the handoff disclosure. No paid provider was used.

No actionable interface finding remains within this change scope. **Approve** with the coverage limits above.
