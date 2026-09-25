# Orglet's browser

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/browser-dark.png">
  <img src="images/orglets/browser-light.png" alt="" width="112" height="112" align="right">
</picture>

An orglet can open and read web pages in a real Chrome or Edge window that Orglet starts for it. The window uses a profile of Orglet's own, never your everyday browser profile. This first version only reads: the orglet opens a page, reads it as text, looks for something on it, scrolls it and keeps a screenshot for you. It never clicks, types, submits a form, downloads or uploads anything.

Use it when [reading a web page](agent-tools.md#public-web-tools) is not enough: a page that only shows its content after its scripts run, a long page you want searched, a site you signed in to yourself, or an app running on your own computer at `localhost`.

Part of the [user guide](user-guide.md). The other permissions are in [agent-tools.md](agent-tools.md).

## Turn it on

1. Open the chat's **Details** and find **Tool permissions**, or open the orglet's settings and its **Permissions** tab.
2. Set **Browser** to **Read pages**.

**Browser** is off in every chat until you turn it on, including chats you had before this version. Demo orglets do not use tools, so the control is disabled for them with one line saying why.

With the browser on, the chat's **Details** also shows **Browser profile** and **Sites** under the MCP permissions.

## Profiles

A profile is what the browser remembers: cookies, sign-ins and site data.

- **Clean** is the default. Each run opens a private window that is signed in nowhere, and everything it stored is thrown away when the run ends.
- A **named profile** is one you make and sign in to yourself. Open **Settings → Browser**, choose **Add profile** and give it a name, for example `Work`. Then choose **Open to sign in**: a normal browser window opens, and you sign in to the sites you want orglets to read. Close the window when you are done. In a chat's **Details**, pick the profile under **Browser profile**.

Each named profile has a menu with **Close window**, **Clear data** (removes every sign-in, cookie and site's data in it, and keeps the profile) and **Delete profile**. A profile a run is using cannot be closed, cleared or deleted until the run ends.

A chat with a named profile opens only the sites on its list of allowed sites. A signed-in profile can see your accounts, so a page must never be able to lead the orglet to one you did not name.

**Chrome or Edge.** Orglet uses Chrome when it is installed and Edge otherwise, and **Settings → Browser** shows which one it found. A new Edge profile signs in to Microsoft sites with your Windows account on its own (we checked this on Windows 11 with Edge 153). The **Clean** profile does not, on either browser, because it is a private window. If you want a named profile that is signed in only where you signed in yourself, install Chrome.

## Sites

Each chat has its own site list under **Details → Tool permissions → Sites**. Type an address, such as `example.com` or `localhost:3000`, choose **Allowed** or **Blocked**, and choose **Add**.

- On the **Clean** profile, public sites open, except blocked ones.
- A blocked site never opens, and neither do its subdomains. Blocking `example.com` also blocks `www.example.com`.
- A page on this computer or your local network (`localhost`, `127.0.0.1`, `192.168.x.x`, a `.local` name) opens only when that exact address, host and port, is allowed. Allowing `localhost:3000` does not open `localhost:8080`.
- On a **named profile**, only allowed sites open.
- Settings, extension and file pages (`chrome://`, `edge://`, `file://` and the like) never open, whatever the list says.

The rules apply to every step, not only to the address the orglet asked for. A redirect, a frame inside a page, an image, a script, a web socket: each connection is checked, and one the list does not allow is refused. A shorter list takes effect at the orglet's next step.

A [side thread](team-chat.md#side-threads) uses its main chat's profile and site list and cannot change them. It is never wider than its main chat: a site is allowed only when both lists allow it, and what the main chat blocks is blocked there too.

## What the orglet can do

- Open a page, in a new tab or in one it already has open. A run has at most four tabs.
- Read the page. It gets the page's structure as text: headings, text, links, buttons and form fields with their labels. It is not a picture. A long page comes in parts of 20,000 characters.
- Look for something on the page, and get only the lines that match, with the headings they sit under.
- Scroll, for pages that load more as you scroll.
- Keep a screenshot of what the page shows, for you to look at. The orglet itself cannot see images in this version.
- List and close its own tabs. A run never sees another run's tabs or yours, and its tabs close when its turn ends.

What a page says is untrusted, like a [web page](agent-tools.md#public-web-tools): instructions on it do not give the orglet any permission, and an app change the orglet proposes after reading a page always waits for your click.

## What you see

- While it works, the bar above the message box says where it is: **Researcher is on example.com…**
- In the answer's steps: **Opened example.com**, **Read the page example.com**, **Searched the page**, **Took a screenshot of example.com**. A page the rules refused shows as a step that did not go through, with the reason.
- **Details → Browser** lists the chat's browser steps, newest first, each with its site and time. A step with a screenshot has a button to view it.
- The window is real. It opens minimized so it does not cover your work; the browser shows on the taskbar while a run uses it. **Show browser window** in **Details → Browser** brings it forward. Chrome and Edge show the bar that says the browser is controlled by automated software.
- **Stop** stops a step in the middle, a page that is still loading included.

## Schedules and crews

A [schedule](routines.md) can read pages too. In the schedule's editor, under **Limits & permissions**, set **Browser** to **Read pages**, pick a profile and fill in its sites. Saving the schedule approves that profile and that list: change either and the schedule needs saving again before it runs.

A crew's chat has the same **Browser** control as any chat, and every member that runs in it may read pages under the chat's list.

## How it works

**Where each part runs.** The core decides every step before it happens: whether the chat has the browser on, whether the profile is the one the run started with, and whether the address passes the site list. It records each step in a journal. A separate browser host process, started by the main process the first time a run needs it, drives Chrome or Edge through `playwright-core` over a pipe, never a debugging port. The main process keeps the named profiles, as folders under Orglet's data folder, and relays the core's steps to the host. The window only shows state: profile names and dates, never their folders.

**The two gates.** Every connection the browser makes goes through a small proxy inside the host process, including connections to this computer. The proxy looks each name up itself, refuses one that points into a private network unless the chat allows that exact address, and connects to the address it checked, so a name cannot switch to a local address between the check and the connection. It sees every hop of a redirect, which a hook on the page's requests does not. A second check on the page's requests refuses blocked sites and, on a named profile, pages and frames on sites that are not allowed. Before a page is read or pictured, the page's address and every frame's address are checked again.

**What is kept.** Each step is a journal row: the run, the step, the tab, what kind of step, the site, the risk (every step here is a read), what came of it and the screenshot, if any. Screenshots are PNG files kept in Orglet's database on this computer, at most ten per run. Both go when you delete the chat, and neither goes into a [backup](settings.md#backup-and-restore). A backup carries no browser profile and no site list; after a restore, turn the browser on again and pick the profile.

**Unknown outcomes.** Every step here is a read. A step that was running when the app closed simply runs again when the run continues.

**Network.** The browser has network, the way an [MCP server](mcp.md) you add does. Commands in a working folder still have none, not even loopback, and turning the browser on does not change that.

**Cost.** Each model step sends the conversation again. A page's text can be long (a pricing page read at about 50,000 characters in our tests), so only the latest page stays whole in later steps and older ones keep their first 1,500 characters. Looking something up on a page returns only the matching lines.

## What it never does

- Use or attach to your everyday browser profile.
- Click, type, submit, download, upload, accept a dialog or follow a popup.
- Open settings, extension or file pages, or a page on this computer or your network you did not allow.
- Solve a CAPTCHA or sign in for you. You sign in yourself, in **Open to sign in**.
- Send anything to Orglet or anyone else. `playwright-core` sends no usage data; Chrome and Edge follow their own settings.

## Limits

| Limit | Value |
|---|---|
| Tabs per run | 4 |
| Screenshots per run | 10 |
| Snapshot part | 20,000 characters |
| Opening a page | 30 seconds |
| Sites per chat | 100 |
| Named profiles | 20 |
| Browser left open after the last run | 1 minute |

## Acting on pages before Orglet can

Clicking and typing on pages is planned, with a card that asks you before anything that submits, pays or deletes. Until then, you can add Microsoft's Playwright MCP server by hand in **Settings → MCP** ([mcp.md](mcp.md)). Set it up so it cannot reach your own browser:

1. **Command:** `npx`. **Arguments**, one per line: `-y`, `@playwright/mcp@0.0.82`, `--isolated`, `--image-responses`, `omit`.
2. Pin the version, as above. `@latest` would run whatever was published most recently.
3. Keep `--isolated`, so the server's browser keeps its profile in memory and forgets it. Never add `--extension`, which attaches to your own signed-in browser.
4. `--image-responses omit` keeps screenshots out of the answers, which Orglet does not show to the model anyway.

Know what you give up: an MCP server's calls are approved per tool, not per site, its `--allowed-origins` option is not a security boundary and does not cover redirects, schedules never get MCP tools, and nothing it does appears in **Details → Browser**. For Chrome DevTools MCP, add `--no-usage-statistics` and `--no-performance-crux`; it sends usage data and page addresses by default.
