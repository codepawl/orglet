# Connectors

Connectors are the services an orglet can reach after you sign in to them in your browser: Google (Sheets, Drive, Docs, Slides, Calendar and Gmail), plus Linear, Notion, Atlassian and GitHub. Each one is an [MCP server](mcp.md) that Orglet sets up for you (Google's is built into Orglet), so the choice of which orglet may use it, the approval of every call and the limits are the ones described there.

Part of the [user guide](user-guide.md).

## Connect Google

1. Open **Settings → Connectors** and choose **Connect Google**. Orglet opens your browser at Google's sign-in page.
2. Choose **Allow**.
3. Back in Orglet, the question **Which orglets may use Google?** lists every orglet, all ticked. Untick any you do not want, then choose **Done**.

That is all. You never make a Google Cloud project or an OAuth client: Orglet signs in with CodePawl's own Google client. One sign-in covers every Google service, so the row says **Google** with **Sheets · Drive · Docs · Slides · Calendar · Gmail** under it, one **Connected** mark, and one **Disconnect**. While the browser is open the row says **Waiting for the browser…** with **Cancel**; a sign-in you do not finish stops after five minutes.

Google appears as one server named **Google** in **Settings → MCP**, and every call an orglet makes still asks you in the chat. **Done** only decides which orglets may use it; you can change it later in an orglet's **Permissions** tab, under **MCP servers**.

**Disconnect** asks once, then removes the Google server and the sign-in saved on this computer. If Google needs you to sign in again (the sign-in was revoked, for example), the row shows **Sign in to Google again**.

### Google tools

Orglet's Google tools are its own: they call Google's generally available REST APIs with your sign-in, from inside the app. They do not use Google's remote MCP servers, which are a developer preview that Google limits to its preview program. The server is named **Google**, so an orglet sees the tools as `mcp__google__<tool>`.

| Tool | What it does | Changes something |
|---|---|---|
| `sheets_get_spreadsheet` | Title and tabs with their sizes | no |
| `sheets_read_values` | Values of a range, as shown | no |
| `sheets_update_values` | Overwrites a range | yes |
| `sheets_append_rows` | Adds rows at the end of a table | yes |
| `drive_search_files` | Finds files by name, type or a Drive query | no |
| `drive_get_file` | One file's details | no |
| `drive_read_file` | Docs and Slides as text, Sheets as CSV (first tab), small text files | no |
| `docs_read_document` | A document as text with its headings | no |
| `slides_read_presentation` | The text of every slide | no |
| `calendar_list_calendars` | The calendars of the account | no |
| `calendar_list_events` | Events in a time range (default: the next 7 days, primary calendar) | no |
| `gmail_search_messages` | Messages matching a Gmail search: sender, subject, date, snippet | no |
| `gmail_read_message` | One message as text, with attachment names | no |
| `gmail_create_draft` | A draft in Gmail | yes (a draft only) |

Wherever a tool asks for a file, you can give a full Google address or the file ID. **Gmail is never sent by Orglet:** the draft waits in Gmail until you open it and send it yourself. Every answer is cut to 20,000 characters and tables to 500 rows, and the answer says when it was cut. The tools marked read-only are the ones an app trigger may call on its own; the three that change something always ask in the chat first.

When Google refuses, the orglet gets a short reason: the signed-in account has no access to that file, it was not found, Google is limiting requests, or the sign-in ran out. In the last case the Google row asks you to **Sign in to Google again**; a short-lived token is refreshed by itself first.

**Scopes.** One consent asks for `spreadsheets`, `documents.readonly`, `presentations.readonly`, `drive.readonly`, `calendar.calendarlist.readonly`, `calendar.events.readonly`, `gmail.readonly` and `gmail.compose`. In Google's terms `spreadsheets`, `documents.readonly`, `presentations.readonly` and the two calendar scopes are sensitive, and `drive.readonly`, `gmail.readonly` and `gmail.compose` are restricted, which is what an app that Google has not verified is limited by. The Google Cloud project behind the sign-in needs the Sheets, Drive, Docs, Slides, Calendar and Gmail APIs turned on.

**Upgrading.** An earlier build saved six separate Google servers. At the next start Orglet replaces them with the one **Google** server, moves the sign-in across (its permissions already cover the new tools) and gives the new server to every orglet that could use any of the six.

### How the sign-in works

Google asks for a client secret when an app trades its code for tokens, and a secret cannot be kept safe inside a desktop app. So the app holds only CodePawl's public client ID. Its two token requests (the code exchange at sign-in, and each refresh) go to a small CodePawl service, `connect.orglet.codepawl.com`, which adds the secret and passes Google's answer back unchanged. It keeps nothing and writes no token, code or request body to its logs; the code is in [services/connect](../services/connect/README.md).

Orglet asks for the permissions the tools need together (listed above), once, and asks for offline access so the sign-in lasts longer than an hour. The Google server keeps the sign-in and refreshes it itself, through the same service or Google, whenever Google answers 401 or the token is about to run out.

The sign-in always comes back to `http://127.0.0.1:53127/callback`. If another program is using port 53127, the sign-in stops and says the fixed port is busy. Close that program and try again.

### Use your own Google client (advanced)

Choose the menu on the Google row, then **Use your own Google OAuth client**, if you would rather use your own Google Cloud project. You turn on the Sheets, Drive, Docs, Slides, Calendar and Gmail APIs in the project, make an OAuth client of type **Web application**, add `http://127.0.0.1:53127/callback` to its **Authorized redirect URIs**, add your email to **Test users**, and paste its **Client ID** and **Client secret** into the form. Orglet then signs in to Google directly with your client, without the CodePawl service, the next time you connect. **Use CodePawl's client** in the same menu goes back.

## Other services

For Linear, Notion and Atlassian, choose **Connect** on the service, approve Orglet in the browser, and go back to the app. The row shows **Connected**. GitHub takes a token instead: **Add token** opens the form with the address filled in. Then open an orglet's **Permissions** tab, tick the service under **MCP servers**, and choose **Save orglet**.

## Where things are kept

- CodePawl's Google client ID is public and part of the app. The client secret is not in the app, in your backups or on your computer; it lives only as a secret of the CodePawl service.
- A client you enter yourself is encrypted with your system's secure storage (DPAPI on Windows, Keychain on macOS) in a file beside the API keys. The window can read the Client ID back, never the secret.
- A connected service's tokens are stored with the server's other secret values, as in [MCP servers](mcp.md#how-it-works).
- None of this goes into backups, crew templates or sync. The servers themselves (name and address) are ordinary MCP server records; the Google one carries a reserved address (`google.tools.orglet.invalid`) that no request is ever sent to, so an older Orglet reads it as an ordinary server it cannot reach.

## What it cannot do

- Google Chat (`chatmcp`) is not offered yet.
- Slack and other services that only accept an app registered by their company are not offered until CodePawl registers one.
- The row does not show which Google account is connected: that needs one more permission, which Orglet does not ask for.
- The Google sign-in and tools have been checked against stand-ins for Google and for the CodePawl service, not against Google itself. An app Google has not verified shows a warning screen and works for up to 100 test users, so the first real sign-in is the first real check.
- Google Chat, Tasks and Contacts have no tools yet.
