# Desktop apps

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/desktop-dark.png">
  <img src="images/orglets/desktop-light.png" alt="" width="112" height="112" align="right">
</picture>

On Windows, an orglet can read and use the windows of apps you grant to a chat: a notes app, a form in an accounting program, the settings of a tool you use every day. It works through Windows UI Automation, the same interface screen readers use. It never moves your mouse, never types with your keyboard and never brings a window to the front, so you can keep working while it does.

At the first level, **Read windows**, it only reads: it lists the granted apps' windows, reads one as text and keeps a picture of it for you. At the second level, **Read and act**, it can also press buttons, fill in fields, tick boxes, open menus and pick from lists. Anything that could send, delete, save over a file, close an app or confirm a dialog stops and asks you first, every time.

Part of the [user guide](user-guide.md). The other permissions are in [agent-tools.md](agent-tools.md). For web pages, [Orglet's browser](browser.md) is the better tool.

## Turn it on

1. Open the chat's **Details** and find **Tool permissions**, or open the orglet's settings and its **Permissions** tab.
2. Set **Desktop apps** to **Read windows**, or to **Read and act** to let the orglet use the apps as well.
3. Open the app you want the orglet to use, if it is not open already.
4. In the chat's **Details**, under **Granted apps**, choose **Add app** and pick the app from the windows that are open now.

**Desktop apps** is off in every chat until you turn it on, including chats you had before this version, and a chat starts with no app granted. Demo orglets do not use tools, so the control is disabled for them with one line saying why. On macOS and Linux the control is disabled and says it is for Windows only.

## Which apps

Each chat has its own list under **Details → Tool permissions → Granted apps**. The list names programs, such as `notepad.exe`, not single windows: every window a granted program opens, its dialogs included, is visible to the orglet, and nothing else is. Other apps, the desktop and the taskbar are invisible to it. The orglet cannot start, close or switch apps, so the app has to be open.

- Remove an app with the **×** beside it. The orglet's next step in that app is refused, even in a run that is already going.
- An app added while a run is going reaches the next message, not that run.
- An app that runs as administrator is shown in the picker but cannot be added: Windows keeps it out of reach of normal apps, Orglet included.
- Some programs can never be added: Orglet itself, password managers (1Password, Bitwarden, KeePass, LastPass, Dashlane, NordPass, Enpass, RoboForm, Keeper, Proton Pass), and the Windows sign-in, password and administrator prompts.

A [side thread](team-chat.md#side-threads) uses its main chat's apps and cannot change them. It is never wider than its main chat: an app the main chat removes is gone from the side thread at once.

## What the orglet can do

At **Read windows**:

- List the windows of the granted apps, with their titles.
- Read a window. It gets the window's structure as text: each button, field, check box, list and menu with its name, its value, whether it is checked, selected or disabled, and what can be done with it. It is not a picture. A long window comes in parts of 20,000 characters.
- Look for something in a window, and get only the lines that match.
- Keep a picture of a window, for you to look at in **Details**. The orglet itself cannot see images in this version. A minimized window cannot be pictured, and Orglet does not restore it for that.

At **Read and act**, also:

- Press a button, a menu item or a link.
- Replace the text in a field.
- Tick or untick a check box or a toggle.
- Open or close a menu, a tree item or a drop-down list.
- Pick an item in a list, a tab or an option.
- Scroll a list so an item is in view.

The orglet names each element by a mark from its latest reading of that window. If the element went away or changed its name, the step is refused and the orglet reads the window again. After each step it gets the window as it is now.

There are no keys, no mouse clicks and no coordinates. When an element offers no way to do a step in the background, the step comes back as **not possible in the background**, and the orglet says what is left for you. It never falls back to your real mouse or keyboard.

What a window shows is untrusted, like a [web page](agent-tools.md#public-web-tools): text in an app never gives the orglet a permission, and an app change the orglet proposes after reading a window always waits for your click.

## When the orglet asks you

Orglet decides how serious each step is from what the app reports about the element. The orglet has no say in it.

A step **asks you first** when it presses or toggles:

- An element whose name is like send, pay, buy, order, delete, remove, post, publish, confirm, submit, reply, share, approve, accept or agree (the same words as [the browser](browser.md#when-the-orglet-asks-you), in English and Vietnamese), or like save, save as, overwrite, replace, discard, don't save, close, exit, quit, restart, shut down, install, print or empty, and the Vietnamese lưu, ghi đè, thay thế, không lưu, đóng, thoát, khởi động lại, tắt máy. Accents do not matter: "Luu" counts, and so does "XOÁ".
- The default button of a dialog, or a dialog button such as OK, Yes, Continue, Apply or Allow.

The card appears in the chat under the orglet's name: **Researcher wants to press “Save” in “Untitled - Notepad”**, with why Orglet asks and a picture of the window with the element outlined. Choose **Allow once** or **Don't allow**. There is no "always": the next such step asks again. A declined step comes back to the orglet as declined, and it does not try it again in that turn.

Only a chat with one orglet can ask, side threads included. In a crew or a group chat a step that would ask is refused, and the orglet tells you what is left for you to do.

**Stop** while a card is waiting cancels the step and the run. A card nobody answers for 15 minutes counts as not allowed.

## Never, whoever asks

- Enter text into a password field, or a field named like a password or a PIN.
- Reach an app that runs as administrator, or a Windows administrator prompt.
- See or use an app you did not grant, Orglet itself, or a password manager.
- Move your mouse, type with your keyboard, click at a position on the screen, or drag.
- Bring a window to the front, restore a minimized one, or start or close an app.

## What you see

- In the answer's steps: **Read the window “Untitled - Notepad”**, **Entered text into “Text editor” in “Untitled - Notepad”**, **Pressed “Add line” in “Notes”**, **Asked to use “Save” in “Notes” · allowed** or **· declined**. A step that was refused shows as a step that did not go through, with the reason.
- **Details → Desktop apps** lists the chat's steps, newest first, each with its window and time. An acting step names its element and says whether it was plain **input** or **asked first**, and whether you allowed it. A step with a picture, including the one a card showed, has a button to view it.

## Schedules and crews

A [schedule](routines.md) never uses desktop apps: it runs while you may be using those very apps, and nobody is there to answer a card. Saving a schedule with **Desktop apps** on is refused.

A crew's chat and a group chat have the same **Desktop apps** control as any chat. Their orglets may read windows and do plain input, but a step that would ask you is refused.

## How it works

**Where each part runs.** The core decides every step before it happens: whether the chat has desktop apps on, whether the window's program is one the chat still grants and the run started with, and for an acting step how serious it is. It records each step in a journal. A helper process does the reading and acting: Windows PowerShell 5.1, which every Windows 10 and 11 has, running a script that ships inside Orglet and uses .NET's UI Automation. Nothing new is installed. The core starts the helper the first time a step needs it, at below-normal priority so it does not compete with your work, with none of your keys or tokens, and stops it after a minute with nothing to do. They talk over the helper's standard input and output.

**Reading a window.** The helper walks the window's UI Automation tree, up to 1,500 elements, and writes one line per element. It keeps the elements of each run's latest reading of each window, so a mark names one element for that run only.

**An acting step.** The helper reads the element again, live: its name, its kind, whether it is a password field, whether it sits in a dialog and is its default button, and which patterns it supports. The core sets the risk from those facts alone (`core/tools/desktop-risk.ts`). A step that asks waits in the running turn. Right before acting, the helper checks the window still belongs to a granted program and the element still has the same name and kind; an app that swapped "Next" for "Delete" while you were asked gets read again instead of pressed. The step itself is one UI Automation pattern call: Invoke, Value, Toggle, ExpandCollapse, SelectionItem or ScrollItem. A button that opens a modal dialog keeps that call busy until the dialog closes, so after five seconds the step comes back as done with a note that the app may be showing a dialog, which is a separate window the orglet can list.

**Pictures.** The helper draws the window off screen with Windows' `PrintWindow`, which does not bring it forward. A minimized window has nothing to draw.

**What is kept.** Each step is a journal row: the run, the step, what kind of step, the program and window, the element for an acting step, the risk the core set (read, input or consequential) and what came of it (done, refused, failed, declined or unknown). Pictures, including the ones cards show, are PNG files kept in Orglet's database on this computer, at most ten per run. Both go when you delete the chat, and neither goes into a [backup](settings.md#backup-and-restore). A backup carries no granted app either; after a restore, turn desktop apps on again and add the apps.

**Unknown outcomes.** A reading step that was running when the app closed simply runs again when the run continues. An acting step goes through the same tool journal as file edits: an input step may run again, but a step that asked you and was running when the app closed is never run again on its own. A card that was still waiting when the app closed counts as declined.

**Which apps work.** UI Automation reaches apps built with WPF, Windows Forms, classic Win32 controls and WinUI 3 well: buttons, single-line fields, check boxes, lists and menus. A multi-line text box in a classic Win32 app, such as the page of the classic Notepad, can be read but not typed into, because it offers no way to set its text in the background. Electron apps vary: some expose their controls, some only a few. Apps that draw everything themselves, such as Flutter apps, games and canvas-based editors, expose nothing to read or press. Store apps are found through their own program, not the frame Windows wraps them in.

## What it never does

- Move the real mouse or type with the real keyboard, or send input to a window in any other way than a UI Automation pattern.
- Bring a window to the front, restore it, start an app or close one without asking.
- See an app you did not grant, Orglet itself or a password manager, or reach an app running as administrator.
- Take a step that could send, delete, save over a file, close an app or confirm a dialog without asking you first, or ask in a way that lets you say "always".
- Enter a password.
- Run in a schedule.
- Send anything to Orglet or anyone else.

## Limits

| Limit | Value |
|---|---|
| Apps per chat | 20 |
| Elements in one reading of a window | 1,500 |
| Snapshot part | 20,000 characters |
| Text entered in one step | 4,000 characters |
| Pictures per run, card pictures included | 10 |
| Waiting for one step before it counts as busy | 5 seconds |
| Waiting for your answer | 15 minutes |
| Model steps in a run that may act | 24 |
| Helper left running after the last step | 1 minute |
