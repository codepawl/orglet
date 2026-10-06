# App components

Which component to use for a need in the Orglet desktop app. Kit components (`packages/orglet-ui`) are documented in
`packages/orglet-ui/skills/orglet-ui/SKILL.md`; here only the app's own components and the wrappers the app puts
around kit ones.

Reading map:

- Shell and sidebar: area rail, sidebar rows, open chats, user panel, pages, spaces
- Chat: thread, message, composer, modes, forwarding, reactions, starters, avatars, mascots
- Files and viewers: attachments, source viewer, editors, markup, diff, documents
- Runs and automation: live island, browser live view, desktop glow, trace, crew plan, permissions, proposals, plan usage
- Settings and identity: archive, status marks, provider marks, flags, font samples, command blocks
- Kit wrappers: what the app adds around a kit component

Paths in the File column are relative to `apps/desktop/src/renderer/` (or `packages/orglet-ui/` where marked).
Core logic lives in the named `renderer/*.ts` or `shared/*.ts` helpers, not in the component.

## Shell and sidebar

| Need | Use | File |
|---|---|---|
| Left rail of areas (Home, Channels, Activity, spaces) | `AreaRail` (`entries`, `createItems`, `onHover`); entries take `icon`, `label`, `active`, `count`, `onSelect`, `menuItems`; a folder entry groups tiles | `components/AreaRail.tsx` |
| Space tile or mark | `SpaceMark` (`seed`, `color`); `SpaceDialog` (`open`, `draft`, `workspace`, `onCreated`) creates or edits a space | `components/SpaceMark.tsx`, `components/SpaceDialog.tsx` |
| Collapsible sidebar group | `SidebarSection` (`id`, `title`, `action`); whole heading toggles, one `+` action at right | `components/SidebarSection.tsx` |
| Sidebar rows | `SidebarTreeRow` (`children` = rows under it, `childrenLabel`), `SideThreadRow`, `ScheduleRunRow`, `ChannelRow`, `ShowMore` (`isActive`), `useReorder` | `components/SidebarTree.tsx` |
| Open chats list (the working set) | `OpenChatRow` (`item`: `name`, `face`, `state`, `active`, `onOpen`; `onClose`); logic in `openChats.ts` | `components/OpenChats.tsx` |
| Account and Settings entry at the sidebar foot | `UserPanel` (`name`, `status`, `connected`, `items`, `trailing`) | `components/UserPanel.tsx` |
| Home: friends, templates, import, archived orglets | `FriendsPage` (`archived`, `templates`, `onCreate`, `onRestore`, `onImport`) | `components/FriendsPage.tsx` |
| Activity page (running, saved, notices) | `ActivityPage` (`tab`, `onTab`, `running`, `tasks`, `saved`, `onOpenChat`) | `components/ActivityPage.tsx` |
| Notifications list | `NoticeList` (`open`, `onOpenChat`, `chatExists`, `updateReady`); notice store in `notifications.tsx` | `components/NoticeCentre.tsx`, `components/notifications.tsx` |
| Member column of a channel | `MemberColumn` (`you`, `members`, `others`, `working`, `leadId`, `onMessage`, `onEdit`, `onRemove`) | `components/MemberColumn.tsx` |
| Channel create or edit | `ChannelDialog` (tabs General and Members; members are `Checkbox` rows) | `components/ChannelDialog.tsx` |
| Views of one chat (Chat, Files, Changes, Schedules, Memory) | `ChatHeader` (`lead`, `views`, `actions`), `ChatViewTabs` (`views`, `current`, `onSelect`), `ChatViewPanel` | `components/ChatViews.tsx` |
| Page opened from the navigation, inside the main panel | `PanelPage` (`pageKey`, `icon`, `title`, `description`, `actions`, `onClose`) | `components/PanelPage.tsx` |
| Tabs inside a page | `PageTabs` (`tabs`, `current`, `onSelect`, `label`); quiet text tabs | `components/PageTabs.tsx` |
| Search across chats, orglets, crews | `SearchDialog` (`open`, `workspace`, `onOpenChat`, `onOpenOrglet`, `onOpenCrew`) | `components/SearchDialog.tsx` |
| Details panel of a chat | `DetailsPanel` (run story, cost, permissions, browser) | `components/DetailsPanel.tsx` |

Sidebar facts:

- Rows under an orglet (side threads, a schedule's newest run) hang off a thread line drawn in CSS on `.tree-children`. A new child row wears `side-thread-row` or joins that selector; it never draws its own line.
- Put a row's menu inside `<span data-no-drag>` so it floats over the row's end and does not take the name's width.
- Click selects; press-and-hold or Alt+Arrow reorders. No double-click rename: rename lives in the edit dialog or the row menu.
- Task menu: Edit, Rename, Archive, Delete. Archived items never sit in the sidebar or rail; they live in Settings, Archive.
- Row-menu archive, restore and delete answer in a toast (`rowAction` in `App.tsx`), never the chat banner. An archive toast carries Undo and `archive: true`. A refusal carries the way out (`removalBlocker` in `shared/removal.ts`).
- The Open list is renderer chrome (`orglet.chat-tabs` in `openChats.ts`), never a `tasks` row or an opener; `App.tsx` derives the open entry from what is on screen.

## Chat

| Need | Use | File |
|---|---|---|
| Task chat (turns, replies, report) | `TaskThread`, `ChatReply`, `ReportView`; `taskWorkers`, `assigneeLabel` in `assignees.ts` | `components/TaskThread.tsx` |
| A message in the thread | `Message` (`className`, `header` `{face,name}` or none when continued, `at`), `MessageFoot` (`badges`, `receipts`), `PersonFace`; grouping in `messageGroups.ts`; `MessageActions` toolbar | `components/TaskThread.tsx`, `components/MessageActions.tsx` |
| Side thread beside its main chat | `SideThreadPanel` (right panel, own `FollowUpComposer`) | `components/SideThreadPanel.tsx` |
| Prompt bar | `Composer` (`attachments`, `onRemoveAttachment`, `leading`, `mode`, `usage`, `context`, `sendDisabled`) | `components/Composer.tsx` |
| Approval mode beside the plus | `ApprovalModePicker` (`mode`, `rows`, `onSelect`), `ChatModePicker`; `shared/approval-mode.ts`, `planFirst.ts` | `components/ApprovalModePicker.tsx` |
| Chat still on Demo | `DemoNote` (`someOnDemo`, `preflight`, `onConnect`); `chatSettings.ts` | `components/Composer.tsx` |
| Forward a message | `ForwardPicker` (`request`, `options`, `sending`, `onSend`, `onClose`); `forward.ts` | `components/ForwardPicker.tsx` |
| Reactions | `ReactionBar` (`options`, `picked`, `onPick`, `label`), `ReactionBadges` (`badges`, `align`, `onPick`); `MessageBadges` binds them to a message | `components/ReactionBar.tsx`, `components/MessageActions.tsx` |
| Empty-chat openers | `Starters` + `suggestStarters` (`shared/starters.ts`) | `components/Starters.tsx` |
| Orglet, crew or entity face | `Avatar` (`name`, `seed`, `mascot`, `defaultMascot`, `hint`, `color`, `badge`, `size`, `motion`); `RosterAvatars` for a group | `components/Avatar.tsx` |
| Choose an avatar | `AvatarPicker` (`hint`, `hints`, `taken`, `savedColors`, `onSavedColorsChange`) | `components/Avatar.tsx` |
| Mascot art | `Mascot` (`id`, `glyph`), `mascotIds`; `mascotSuggest.ts` (`rankMascots`, `suggestedMascots`, `autoMascot`) | `components/mascots.tsx` |
| 3D face for large sizes | `Orglet3D` (`id`, `seed`, `size`, `color`, `motion`); engine `orgletSolid.ts`, stage `orgletStage.ts` | `components/Orglet3D.tsx` |
| Brand mark (sidebar, unattributed byline) | `<span className="orglet-mark">o</span>` with `.small`, `.large`, `.brand`; Settings, Logo colour | `styles.css` (`.orglet-mark`) |
| Orglet's own cursor over a page | `OrgletCursor` (`x`, `y`, `color`, `name`, `action`, `presses`, `glide`); colour from `workerInk` | `components/OrgletCursor.tsx` |

Chat facts:

- A task is one chat. A message is a turn, not a new task row. Several assignees make a group chat with one byline each.
- No bubbles. A message is a 26px face gutter plus a column: name line (`byline-role`, `byline-provider`, `.message-time`), then content. The same author within 5 minutes shares one head (`data-continued`). Spacing and a faint `--message-hover` tint only.
- `MessageActions` is a `role="group"` toolbar floating at the message's top right, shown on `:hover`, `:has(:focus-visible)` or an open menu. It is always in the tab order and is the message's last child.
- Reactions go in `MessageBadges` inside `MessageFoot`, never in the action row. The trigger always opens with the current face pressed; picking it again removes it. One reaction per person.
- Never set the thread's `scrollTop` yourself. Use `useThreadFollow` (`threadFollow.ts`); a card that needs the person joins `needsPersonKey`.
- An answer handed in because the steps ran out carries `OutOfStepsLine` (outline Continue on the latest turn) in the `outOfSteps` slot of `turnNotices`.
- Composer: the box holds only text, the reply and attachment zones, and send or stop. One 28px toolbar row sits under it: plus at left; model picker, recipient list or side-thread send options, then the `usage` ring at right. `ComposerFoot` is only the note line.
- Composer zones (reply `context`, attachment strip, text) are told apart by spacing, never a line. The attachment strip scrolls sideways and never wraps.
- Never pass `disabled` to hold a send: a disabled focused textarea blurs. Empty the box at once, block the second send with `sendDisabled`, restore a failed message with `restoreUnsent`.
- Unsent text and files stay per chat (`drafts.ts`: `task:<id>`, `worker:`, `team:`, `group:`).
- After touching the composer, measure that the `@`-tag highlight layer and the textarea still agree, collapsed and expanded.
- Approval mode chip is a direct item of the toolbar row after `.composer-leading`, never inside it. Never add Bypass or Auto.
- Starters are computed locally, never a hard-coded list. Never offer one that would fail now. Picking one fills the composer and never sends. A starter with `ownWords` is the person's text and skips `t()`.
- Avatars: pass the entity id as `seed`, the description as `hint`, `<ProviderMark size="small" decorative />` as `badge`. Choosing is optional. `lg`, `xl`, `xxl` draw the 3D solid; smaller sizes draw whole-pixel glyphs. Pass `alive` only to the few faces in the chat being read, never a list.
- Mascots: an orglet is the logo bubble with two upright capsule eyes, no mouth, never an animal. Eyes are white (`eyeColor`); `--mascot-ink` is for hat rims and ties. Never bake a colour into a body, add at most one accessory, and add every new mascot to a category, a lexicon entry, the 3D `looks` table, and `smallGlyphs` as integers. `tests/integration/mascots.test.ts` and `orglet-solid.test.ts` check these.
- Animation: every head transform starts with `translateY(var(--mascot-lift))` and every eye transform with `translateY(var(--gaze-y))`. Reduced motion cuts to the end state.
- Cursor: never change the system cursor.

## Files and viewers

| Need | Use | File |
|---|---|---|
| File attached to a message or routine | `Attachment` (`name`, `bytes`, `onRemove`, `onOpen`, `removeLabel`), `fileKind`, `fileKindIcon`, `fileKindLabel`, `fileSize` | `components/Attachment.tsx` |
| One attached file opened on its own | `SourceViewer` (`open`, `onClose`, `name`, `meta`, `info`, `menu`, `actions`), `SourceDialog` (`detail`, `sourceId`, `lines`, `onClose`) | `components/SourceViewer.tsx` (both) |
| Preview by file kind | `SourcePreview` choosing `CodePreview`, `TablePreview`, `JsonPreview`, `MediaPreview`, `PdfPreview` | `components/SourcePreview.tsx` |
| Pick files or a folder | `SourcePicker` (Files / Folder), used as the composer's `leading` | `components/SourcePicker.tsx` |
| Edit text or code in the viewer | `TextEditor` (`initialText`, `language`, `label`, `onDirtyChange`, `onSave`, `handle`); modes `TextEditing`, `ImageEditing`, `PdfEditing` | `components/TextEditor.tsx`, `components/SourceEditing.tsx` |
| Mark up a picture or PDF | `MarkupToolbar`, `MarkupCanvas`, `markupPng`, `usePicture`; model `markup.ts`, PDF `pdfMarkup.ts`, `pdfWriter.ts` | `components/ImageMarkup.tsx`, `components/PdfMarkup.tsx` |
| One choice among small icon buttons | kit `ToolbarToggleGroup` (`label`, `items`, `value`, `onValueChange`) | `packages/orglet-ui/src/components/ToolbarToggleGroup.tsx` |
| What a run changed in its working copy | `DiffViewer`, `DiffBody`, `DiffDialog`, `ChangedFilesLine` (`summary`, `workerName`, `review`, `onOpen`), `DiffCounts`; the Changes view is `ChangesView` | `components/DiffViewer.tsx`, `components/ChangesView.tsx` |
| Document (report, file) | `DocumentCard` (`name`, `meta`, `onOpen`), `DocumentViewer` (`open`, `onClose`, `name`, `actions`) | `components/DocumentViewer.tsx` |
| Workspace recovery of held changes | `WorkspaceRecovery` | `components/WorkspaceRecovery.tsx` |

Viewer facts:

- A source opens in its own viewer, one file per dialog, content first. Every "open this source" path (attachment card, citation with `lines`, Chat sources row) lands in `SourceViewer`. Never stack every file of a chat in one dialog.
- Highlighting is the in-house tokenizer (`highlight.ts`), no dependency, no script run on the content. SVG is shown only as `<img>`. A revoked, Parquet or over-64 MB file shows one calm line.
- `SourcePreview` and the previewers are pure; `SourceDialog` is the only piece that talks to the core.
- Toolbar: close left, name and "kind - size" centred, actions right. Actions: Ask about this (ghost), Edit or Mark up (outline, key E), Open in default app (icon only). Under 900px Ask and Edit drop to icons and keep `aria-label`.
- Editing never overwrites: `saveSourceVersion` makes a new source linked by `editedFrom` and the viewer opens it. While editing: Cancel (ghost), Ask about this (outline, saves first), Save (primary, last, Ctrl+S, disabled until dirty). Every way out of an unsaved edit asks `leaveUnsaved`.
- Never disable a control inside the find bar that may hold focus: a disabled focused button drops focus and Escape then closes the viewer. Elements that open a popup inside a viewer set `data-popup-open` so Escape closes the popup, not the viewer.
- Markup is a plain canvas, no drawing library. Marks are in picture pixels and painted by `paintMarkup` for both screen and saved PNG. PDF pages are drawn by pdf.js; `pdfWriter.ts` loads lazily.
- Diff: one quiet line under the answer ("Changed 3 files - +42 -7"), nothing when nothing changed. Every count is `DiffCounts`. Held changes end the line with where they stand (not applied, applied, applying, conflict, discarded). Apply and Discard sit in the viewer toolbar; with several files each gets a `Checkbox`. `DiffDialog` is the only piece that talks to the core.
- A document is sent like a file a colleague attaches, never poured into the chat. Links that lead elsewhere close the viewer first.

## Runs and automation

| Need | Use | File |
|---|---|---|
| A run working right now | `LiveIsland` (`state`, `label`, `receipt`, `workers`, `leaving`), docked by `IslandDock` + `dockIsland(view)` | `components/LiveIsland.tsx`, `components/islandDock.tsx` |
| Live run in the thread | `LiveRun` with `islandOf`, `workingWorkers` mapping progress to a view | `components/LiveRun.tsx` |
| What a worker did before its answer | `WorkLog` (`entries`, `thinking`, `diffRun`, `onOpenMemories`, children); `traceOf`, `liveTraceOf` in `turnTrace.ts` | `components/WorkLog.tsx` |
| How a crew splits and joins a turn | `CrewPlanFlow` from `crewPlanDiagram` (`shared/crew-plan.ts`) | `components/CrewPlanFlow.tsx` |
| Watch or take over a run's browser | `BrowserLiveSurface` (`runId`, `workerName`, `site`, `controlling`, `onOpenInChrome`), `BrowserLivePanel`, `BrowserLiveViewer` | `components/BrowserLiveView.tsx` |
| Desktop glow while an orglet controls an app | `DesktopOverlay` (route `#overlay`), `.orglet-glow` | `components/DesktopOverlay.tsx` |
| A chat's permissions | `PermissionControls` (`workers`, `capabilities`, `grant`, `pending`, `locked`, `onCapability`, `onWorkspace`) | `components/PermissionControls.tsx` |
| A worker's proposed app change | `AppProposalCards` (`proposals`, `workers`, `skills`, `actions`) | `components/AppProposals.tsx` |
| Permission hints, approvals | `PermissionHint`, `BrowserApproval`, `McpApproval` | `components/PermissionHint.tsx`, `components/BrowserApproval.tsx`, `components/McpApproval.tsx` |
| Running view and queue | `RunningGroups` | `components/RunningCentre.tsx` |
| Schedules editor | `RoutinesPanel` | `components/RoutinesPanel.tsx` |
| Subscription plan usage | `PlanUsage` (`windows`, `label`, `now`), `BankedResets` (`resets`, `claiming`, `onClaim`) | `components/PlanUsage.tsx` |

Run facts:

- Island: a tab in the prompt bar's own colour and outline, docked on its top edge, moving with the bar, never the thread. Its bottom corners are real borders, never a gradient. Inside: faces of workers really running, one sentence for what they do now ("Researcher is thinking..."), one grey line for the last finished step. No coloured light or dot beside the sentence. Sentences say what the worker did, never which tool. Only steps the core observed are named. `checkIslandSeam` in `scripts/alignment/rules.ts` guards the seam; `pnpm test:alignment` measures it. Motion uses transform and opacity only; nothing waits on an animation to be visible.
- A run that streams nothing is read from its own latest line (`runEventMessage`), never the chat's latest line.
- Trace: one native `<details>` above the answer; collapsed, a muted count line; open, an ordered list of what the core recorded, never guessed from the answer. Draws nothing for an empty trace.
- Crew plan: built only from saved plan and runs, never model text. Draws nothing for one-part plans, group or solo chats.
- Browser live view: frames on a canvas, never an `<img>` per frame. The orglet's cursor is an element over the canvas, never drawn into the page. One watch per run however many views are open. While the person holds the browser, the surface is `role="application"` and its input textarea carries `data-popup-open`. The Chrome suggestion is one quiet row on `--surface`, never a coloured callout. The island carries Watch (and Hand back once taken over), never Take over.
- Desktop glow: one transparent, click-through, never-focusable window from main. Four edge gradients in the accent, no hard line. Only the top pill takes the pointer. Check it on screen with a `BitBlt` + `CAPTUREBLT` copy; `desktopCapturer` does not see it.
- Permissions: exactly two values is a `SwitchField`, more is a `Select`. Four switches (`source.read`, `dataset.check`, `network.web`, `app.propose`) and one folder row (four levels: none, read, read and edit, read, edit and run). A blocker disables the control with one short line above; never a third state on a switch. With an editable folder, "review before applying" (`workspace.apply` inverted) sits under the folder row. The parent owns bridge calls.
- Proposals: quiet `--surface` cards under the answer. New orglets of one reply share one card with a row each (avatar, name, description, model chip); a new crew shows its people. Values are never ids (skill id to name, provider to `providerName`; see `proposalValues.ts`). Apply and Dismiss icon buttons sit beside the row button, never inside it. An orglet only proposes; it never applies.
- Plan usage: one row per allowance the vendor reports, a 6px `role="meter"` bar (`--accent`, `--warning` from 70%, `--error` from 90%). Never an estimate. Renders nothing for no windows; the caller says why. Using a banked reset asks with `confirmAction` first.

## Settings and identity

| Need | Use | File |
|---|---|---|
| Archived orglets, channels and chats | `ArchiveGroups` (`sections`), `ArchivedRow` (`name`, `mark`, `whose`, `archive`, `onRestore`, `onDelete`); grouping in `archive.ts` | `components/ArchiveSettings.tsx` |
| Status circle (idle, waiting, paused, attention, busy, asking) | `StatusMark` + `taskStatusMark`, `openChatMark`; seen stamp in `shared/task-seen.ts` | `components/StatusMark.tsx` |
| Provider or agent mark | `ProviderMark` (`size="small"`, `decorative`); always left of its name | `components/ProviderMark.tsx` |
| Currency or language flag | `CurrencyFlag` (`code`); SVG, since emoji flags do not render on Windows | `components/CurrencyFlag.tsx` |
| Font samples in Settings | `InterfaceFontSample`, `CodeFontPreview` | `components/FontPreview.tsx` |
| Command to paste | kit `CommandBlock` (`command`, `label`, `toolbar`, `copyLabel`, `onCopy`); the app wraps it as `CommandCopy` / `LoginCommandCopy` | `components/SettingsDialog.tsx` (kit: `packages/orglet-ui/src/components/CommandBlock.tsx`) |
| Settings dialog, connections, harnesses | `SettingsDialog`, `ModelPicker`, `ConnectWays`, `CustomConnections`, `McpSettings`, `BrowserSettings`, `WebSearchSettings`, `AboutSettings`, `AccountSettings` | `components/SettingsDialog.tsx` and neighbours |
| Orglet, task, crew dialogs | `WorkerDialog`, `TaskDialog`, `TacetSetup`, `LocalOnlyDialog` | `components/WorkerDialog.tsx` and neighbours |

Settings and identity facts:

- Archive: Settings, Archive tab holds the auto-delete `Select` as its first row and nowhere else. A group is a `settings-subheading` with its count; an empty group is left out; an empty archive is one muted line (`.archive-empty`). A row is mark in a 26px slot, name over a quiet `whose` line, a days-left pill (only when auto-delete is on), outline Restore, and a `RowMenu` holding permanent delete with its confirm. The app (`archiveSections` in `App.tsx`) words every row and owns the commands.
- `StatusMark`: `variant="asking"` with `tone="accent"` means "needs you" and outranks busy in a roll-up. Paused is two bars on a soft tint. `dashed` is for waiting on something outside the person. Finished work is filled until opened (`seenStamp` matches the current result stamp); a new answer changes the stamp.
- `CommandBlock`: the label, then the command on a quiet card. A control that changes the command goes in `toolbar` with 8px of air under it. The command breaks only after a path separator or a space. Copy goes through `orglet.copyText`, never `navigator.clipboard`.
- Font samples: each card carries its own theme via `.theme-light` / `.theme-dark` (aliases on the palette blocks). A derived token must be declared in the same block, because a custom property resolves where it is declared. Keep snippet lines at 23 characters or fewer.
- Brand mark: the logo is a near-black bubble with two white capsule eyes; the user may switch it to the accent (`data-logo-color`). After touching `apps/desktop/assets/icon.svg`, regenerate icons with `node_modules/electron/dist/electron.exe scripts/build-icon.cjs` and the social card with `pnpm images:social`.

## Kit wrappers

The app wraps these kit components. Import the wrapper from the app file; import from `@codepawlhq/orglet-ui` only for kit components with no wrapper (`Skeleton`, `Viewer`, `Input`, `Textarea`, `ToolbarToggleGroup`, `Tooltip`, `Badge`, `Card`, `Tabs`, `RadioGroup`, `Progress`).

| Need | Use | File |
|---|---|---|
| Button, icon button | `Button` (`variant` primary/outline/ghost, `size="icon"`); re-exported by `ui.tsx` | `components/ui.tsx` |
| Field title, section heading, money | `FieldLabel` (`icon`, `required`), `PanelHeading` (`title`, `description`, actions), `MoneyInput` (display currency, `toMicros`/`toAmount` from `money.ts`) | `components/ui.tsx` |
| Simple centred dialog | `Drawer` (`title`, `description`, `actions`); adds the close label and icon | `components/ui.tsx` |
| Single choice from a list | `Select` (`label` or `ariaLabel`, options with `icon`, `detail`, `group`, `note`, `badge`; `size="sm"`, `menuMinWidth`, `field`); adds the "Chon" placeholder and `.field` layout; replaces `<select>` | `components/Select.tsx` |
| Pick from a list or confirm once | `Checkbox` (`description`, `required`, `labelProps`); re-export | `components/Checkbox.tsx` |
| On or off setting | `Switch` (`labelledBy`), `SwitchField` (title, `description`, switch) | `components/Switch.tsx` |
| Settings-style editor | `TabbedFormDialog` + `DialogTabs`; translates tab names; mark fields with `fieldInvalid(active, flash)` or `invalid`+`flash` props | `components/DialogTabs.tsx`, `components/fieldInvalid.ts` |
| Yes or no question | `confirmAction({ title, description, confirmLabel, cancelLabel })` + `<Confirmer />`; adds default labels | `components/confirm.tsx` |
| Status message | `toast(text, tone, about, { action?, unread? })` + `<Toaster />`; `toast()` records the notice first | `components/toast.tsx` |
| Row overflow menu | `RowMenu` (items with `danger`, `confirm: { question, label }`, `shortcut`); adds the dots icon and `row-action` class | `components/RowMenu.tsx` |
| Detail behind an "i" | `InfoTip` (`label`, `rows: { label, value, mono?, onCopy? }[]`); adds icon and copy label | `components/InfoTip.tsx` |
| Floating panel beside a trigger | `AnchoredPopover` (`anchor`, `open`, `onClose`, `label`); re-export | `components/AnchoredPopover.tsx` |
| Custom colour | `ColorPicker` (`value`, `onChange`, `presets`, `saved`, `onSave`); adds translated labels | `components/ColorPicker.tsx` |
| Content on its way | kit `Skeleton` (`shape`, `width`, `height`), `SkeletonText` (`lines`), `SkeletonGroup` (`label`); no wrapper | `packages/orglet-ui/src/components/Skeleton.tsx` |

Wrapper facts:

- `Select`: the trigger's icon sits in a fixed 20px slot (`--org-select-icon-slot`, 0 for `sm`) so a 16px icon and a 20px flag start the text at the same x; never size an icon to fix one select, change the slot. `note` (a muted word such as "default") shows in the menu only, never in the trigger. Group long lists with `group`. Tune with `--select-*` tokens.
- Select menus portal into the open dialog, flip up and fit the window. Pass `field` so a form can focus the trigger (`TabbedFormDialog`'s `focusField`).
- Other Radix dialogs use the kit's `<DialogOverlay />` for the backdrop and spread `useReturnFocus()` on `Dialog.Content` when opened from state, or Escape drops focus on the page.
- `Drawer` and the kit dialogs return focus to what opened them. `title` can be a breadcrumb; `actions` sit left of the close button.
- `TabbedFormDialog`: vertical tabs, sticky Cancel/Save footer, `error` text left of Cancel, validation that jumps to the tab at fault.
- `Confirmer`: use one question for every exit path of one flow. For a quick question tied to one row, prefer a small popover beside the row (`RowMenu` `confirm`).
- `toast`: never leave "Saved." text in a panel. An `action` adds one underlined text button and keeps the toast 6 s. Every toast is kept in Notifications. A `success` confirms what the person just did and does not count as unread unless it is news that arrived on its own (pass `unread: true`). Errors and `info` always count. `chat` (a task id) makes the notice open that chat.
- `Skeleton`: bars the height of the text they stand in for. Something refreshed behind content on screen says so with a quiet word beside its title (`.setting-checking`). Prefetch and caches: `renderer/prefetch.ts`, `renderer/caches.ts`; rules in `docs/technical-guide.md`, Loading.
- `RowMenu`: appears on hover or focus; `disabled` greys the trigger.
- `InfoTip`: a surface shows what matters, never a grey block of ids and hashes. `mono` for ids and paths; the caller does the copying.
- `AnchoredPopover`: portals into the open dialog, flips above, and scrolls inside when taller than its room, so a flex-column popover gives its children `flex-shrink:0`. Use it instead of pushing a panel inline into a form.
- `ColorPicker`: in Settings it floats in an `AnchoredPopover` from a swatch-shaped custom button. It sets `data-popup-open`, which `keepOpenForPopup` honours so Escape closes the panel, not the dialog.
- `Attachment`: a card, not a pill. The same width every time. Renders an `<li>`. With `onOpen` instead of `onRemove` the whole card opens the file; a sent message shows these as a row above the message, right-aligned and scrolling sideways.
- `ReactionBar`: knows nothing of storage; `name` is what the caller stores, so changing a face strands nothing. Floats above its trigger, closes on Escape, an outside pointer, or a pick.
- `SwitchField` inside a form: title left, switch right, `description` directly under the title.
