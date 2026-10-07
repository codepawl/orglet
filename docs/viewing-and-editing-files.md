# Viewing and editing files

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/viewing-and-editing-files-dark.png">
  <img src="images/orglets/viewing-and-editing-files-light.png" alt="" width="112" height="112" align="right">
</picture>

Every file attached to a chat opens in its own viewer. You can read it there, edit a text or code file, mark up a picture or a PDF, and send the result to the orglet. An edit never changes the file you attached: saving adds a new version to the chat, next to the original.

Part of the [user guide](user-guide.md). How files get into a chat: [Attach files](chat-guide.md#attach-files).

## Open a file

Click a file card in the chat, or open the chat's **Files** tab and click a row. The viewer shows:

- text and code with line numbers and colours
- Markdown as a document, with a **Source text** tab to see the text
- CSV, TSV and Parquet as a table, JSON and JSONL as a tree
- images, video and audio
- PDF pages

Above the content, a slim bar names what you are looking at and how much of it is on screen, with the few controls that change how it is drawn. Each kind has its own:

- **Tables** (CSV, TSV, Parquet). The first row is a header that stays in view while you scroll, and a row-number column stays at the left edge. Columns that hold numbers are right-aligned, header included, in digits of equal width, so they line up. An empty cell shows a faint dash. A long value is cut to the column width; hover it to read the whole value. **Filter rows** narrows the table to the rows with any cell containing your text, and the bar says how many match. Only the first 200 rows are drawn at first and the bar says "Showing 200 of 260 rows"; **Show more rows** adds the next batch. Click a column's header to sort by it (largest or Z last, then largest or Z first, then the file's order again): numbers by value, text in your language's order with numbers inside words read as numbers, empty cells always last; the row numbers stay those of the file. Drag the right edge of a header to make a column wider or narrower. **Ctrl+F** (**Cmd+F** on a Mac) goes to the filter. A Parquet file is read by the local checker (DuckDB, within its 32 MB and 20-second limits), which hands over its first 200 rows; the bar says how many rows the file has in all.
- **JSON and JSONL.** A tree you can fold, with **Source text** one tab away. **Expand all** and **Collapse all** open or close every node, and **Copy** puts the whole text on the clipboard. A file that does not parse opens as code instead of an error.
- **Code and plain text.** The bar shows the language and the number of lines. **Wrap lines** is on by default; switch it off and long lines scroll sideways instead. And **Copy** copies the whole file.
- **Images.** The picture sits on a checkerboard so transparent parts read as transparent, and the bar shows its size in pixels. It opens fitted to the window; **Actual size** (or a click on the picture) shows every pixel, and the same control fits it again.
- **PDF.** The bar shows the page count and the zoom; **Zoom out** and **Zoom in** step through 60% to 150% of the default page width. Pages sit on the grey backdrop with a soft shadow.
- **Markdown.** **Formatted** and **Source text** switch between the document and its text.

The buttons at the top right:

- **Ask about this** puts the file on your next message in this chat and closes the viewer, so you can type your question.
- **Edit** (text and code) or **Mark up** (images and PDFs). The key **E** does the same.
- The arrow opens the file in the program Windows uses for it (images, video, audio and PDF).
- The **i** shows the file's kind, size, where it came from and its hash.
- **⋯ → Revoke read access** stops the orglet reading the file.

A file in a chat restored from a backup opens with **Choose file** instead of its content, since a backup holds no file contents. Pick the same file on this computer and it opens again, for you and the orglet. A different file is refused, even with the same name.

A file that came from another computer through [sync](account.md#files) opens the same way, with **Download to this computer** beside **Choose file** when the account has its contents. Only versions saved in this viewer sync their contents.

## Edit text and code

1. Open a text, code, Markdown, CSV or JSON file.
2. Click **Edit**.
3. Change the text. The editor keeps the file's colours and line numbers.
4. Click **Save**, or press **Ctrl+S**.

The edit is saved as a new file in the same chat: `notes.md` becomes `notes (edited).md`, and editing again gives `notes (edited 2).md`. The viewer then shows the new version, and a message offers **Ask about this**.

Find and replace:

- **Ctrl+F** opens the find bar at the top of the editor, with the selected text already in it.
- **Enter** goes to the next match, **Shift+Enter** to the previous one. The count shows which match you are on.
- The three buttons beside the field match case, match whole words, or treat the text as a regular expression.
- **Replace** changes the current match; **Replace all** changes every match. **Ctrl+Enter** in the replace field replaces all.
- **Esc** closes the find bar.

**Ctrl+Z** undoes and **Ctrl+Shift+Z** redoes. **Tab** indents; to move focus out of the editor with the keyboard, press **Ctrl+M** first, and **Tab** then moves between controls until you press **Ctrl+M** again.

## Mark up an image

1. Open an image.
2. Click **Mark up**.
3. Pick a tool, a colour and a width in the bar under the file name, then draw on the picture.
4. Click **Save**, or click **Ask about this** to save and put it on your next message at once. While you edit, **Save** is the main button, at the end of the row.

| Tool | Key | What it does |
|---|---|---|
| Pen | P | Draws a free line |
| Highlighter | H | A wide, see-through line for marking text |
| Arrow | A | Drag from where the arrow starts to what it points at |
| Rectangle | R | Drag to draw a box |
| Ellipse | O | Drag to draw a circle or oval |
| Text | T | Click where the label goes, type, press **Enter**. **Esc** drops it |
| Crop | C | Drag the part to keep. A click without a drag removes the crop |

- The colours are your theme's red, accent, amber and green, plus black and white.
- The widths are **Thin**, **Medium** and **Thick** (keys **1**, **2**, **3**). The width also sets the size of text labels. Lines and labels are sized to the picture, so they look the same on a small screenshot and a large photo.
- **Ctrl+Z** undoes the last mark or crop and **Ctrl+Shift+Z** redoes it.
- A crop dims what it leaves out until you save, so you can still undo it. The saved picture holds only the part you kept.

A marked-up image is always saved as PNG, at the picture's own size: `screen.jpg` becomes `screen (edited).png`.

## Mark up a PDF

1. Open a PDF.
2. Click **Mark up**.
3. Pick a tool, a colour and a width, then draw on the page, or pick **Text**, click where the note goes and type.
4. Move between pages with the arrows at the end of the bar, or **Page Up** and **Page Down**. Marks stay on the page you drew them on.
5. Click **Save**, or **Ask about this** to save and put it on your next message.

The tools, keys, colours and widths are the ones for images, without crop: a page keeps its size. For notes the widths set the text size: **Thin** 12 points, **Medium** 16, **Thick** 24.

- Notes are typed on one line; press **Enter** to place one, **Esc** to drop it. Vietnamese and other accented letters work, from the keyboard, Unikey or an input method.
- **Ctrl+Z** and **Ctrl+Shift+Z** undo and redo across pages: when a step changes another page, the viewer turns to that page so you see it.
- The page is shown at the viewer's reading width and scrolls down, so its text stays readable while you mark it.

The saved PDF is `contract (edited).pdf`, next to `contract.pdf`, with every page of the original. What you drew and typed is part of the page, so any PDF reader shows it the same way:

- Lines, boxes and arrows are drawn on the page.
- Notes are real text in the PDF, in Inter, the typeface the app uses, embedded with only the letters you typed. You can select and search them in another reader, and the orglet reads them when it reads the PDF's text, after that page's own text.

A PDF that has a password or is locked against changes opens for reading but cannot be marked up; the viewer says so. A note with characters the font does not have, such as an emoji, is refused when you save, with the characters named.

## Leaving without saving

If you close the viewer, press **Esc**, or click **Cancel** with changes that are not saved, Orglet asks first: **Discard changes** throws the edit away, **Keep editing** takes you back. The original file is never at risk either way.

## What a saved version is

- It is a file of the chat, listed in the chat's **Files** tab with its original. The viewer's meta line says which file it was edited from.
- The orglet reads it only when a message carries it: use **Ask about this**, or attach it from the chat's files. Saving alone sends nothing.
- Orglet keeps the edited copy in its own data folder, never next to your file. **Settings → Data → Delete imported sources** and **Erase everything** remove these copies too.
- It counts toward the chat's files like any other.

## What it does not do

- It never writes to the file you attached, or to anything in the chat's working folder. To change a file in the working folder, ask the orglet: its changes wait for you to review before they reach the folder ([Review before the folder changes](chat-guide.md#review-before-the-folder-changes)). To change the file yourself, open it in its own program with the arrow button.
- Video, audio and Parquet files can be viewed but not edited. A PDF's own text cannot be changed; you can mark it up and type notes on it.
- A revoked file, or one too large to show, cannot be edited.
