# Send to and orglet:// links

Two ways into Orglet from outside the app, both on Windows: File Explorer's **Send to** menu, and `orglet://` links. Both only open a chat and fill in its message box. Nothing is sent until you press **Send**.

## Send files from File Explorer

1. In File Explorer, select one or more files.
2. Right-click and choose **Send to → Orglet**. On Windows 11 the **Send to** menu is under **Show more options** (or press Shift+F10).
3. Orglet comes forward with **Send N files to…**. It lists your recent chats first, then your orglets and your crews, each with their faces. Type to narrow the list.
4. Pick one. That chat opens with the files in its message box, as if you had picked them with **+ → Files**.
5. Write your message and press **Send**.

If the chat already has a conversation, the files go into the form for its next message instead, next to the files it already has. If a conversation starts somewhere else while the files wait in the message box, for example from the `orglet` command, Orglet switches to it and moves the files and any text you wrote into that form. Nothing is dropped and nothing is sent.

The usual limits apply: at most 20 files per message, text up to 256 KB, CSV, JSONL and Parquet up to 32 MB, images up to 20 MB, audio up to 50 MB, video and PDF up to 200 MB. Anything that does not fit is listed under the message box with the reason: a folder, a file type Orglet cannot attach, a file over its limit, or the files past the twentieth. To attach a whole folder, use **+ → Folder** in the message box.

If Orglet is not running, Send to starts it. If you send files again before picking a chat, the newer files replace the older ones. Closing the list attaches nothing.

**Settings → About → Send to Orglet in Explorer** turns the menu entry off and keeps it off through updates. Turning it back on adds it again. Uninstalling Orglet removes it.

## orglet:// links

A link can open a chat, or open it with text already in the message box.

| Link | What it does |
|---|---|
| `orglet://chat/Researcher` | Opens the chat with Researcher |
| `orglet://chat/<id>` | The same, by the orglet's or crew's id |
| `orglet://new?to=Researcher&text=Summarise%20this` | Opens the chat with Researcher and puts "Summarise this" in the message box |

Names match the way `orglet --to` matches them: case does not matter, and a unique start of a name is enough. Write a space as `%20` or `+`. If the message box already has a draft, the link's text goes after it. If the chat's conversation starts somewhere else before you send, the text moves with it, the same way files do.

A link can only open a chat and prefill a message. It cannot send, change a setting, grant a folder or a permission, or delete anything. A link Orglet does not understand, a name that matches no orglet or crew, or text longer than 4,000 characters shows a short notice and does nothing else.

## How it works

- **The menu entry** is a shortcut named `Orglet` in your own SendTo folder (`%APPDATA%\Microsoft\Windows\SendTo`). Setup writes no registry key for it and needs no administrator rights. Explorer starts the shortcut once with every selected file, so 20 files are one start, not 20.
- **What it starts.** The shortcut, and the command Windows runs for a link, point at `%LOCALAPPDATA%\Orglet\Orglet.exe`. That small launcher is part of every Setup install. Its path stays the same across updates, and it starts the current version with the same arguments. It is a windowed program, so no console window flashes.
- **The link handler** is registered for your user only, under `HKEY_CURRENT_USER\Software\Classes\orglet`, with the command `"%LOCALAPPDATA%\Orglet\Orglet.exe" -- "%1"`. The `--` stops anything in a link from being read as a program switch. Uninstall removes that key, and only while it still points at Orglet. Nothing is written under `HKEY_LOCAL_MACHINE`.
- **Setup's steps.** Install and every update add the shortcut, unless you turned it off in Settings, and register the links. Uninstall removes both. Your choice is kept as a file named `send-to-off` in the data folder, the same way `cli-path-off` keeps the `orglet` command off PATH.
- **When Orglet is already open,** the new start hands its arguments to the open window and quits. Otherwise the new start is the app, and reads them itself.
- **Files stay in the main process.** The window gets the number of files and their names, never their paths. When you pick a chat, the main process imports the files through the same checks as **+ → Files**, one at a time, so one bad file does not stop the others.
- **A ZIP copy** has no Setup: it registers no links. **Settings → About** can still add the Send to entry, pointing at that copy's `Orglet.exe`.
- macOS has neither for now.

The automatic tests cover reading the arguments and links (valid, malformed, oversized, unknown names), the file limits and skipped files, and Setup's install, update and uninstall steps against a fake SendTo folder. They do not click in the real Explorer or open a link from a browser.
