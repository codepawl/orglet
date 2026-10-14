# Connectors

Connectors are the services an orglet can reach after you sign in to them in your browser: Google (Sheets, Drive, Docs, Slides, Calendar and Gmail), plus Linear, Notion, Atlassian and GitHub. Each one is an ordinary [MCP server](mcp.md) that Orglet sets up for you, so the choice of which orglet may use it, the approval of every call and the limits are the ones described there.

Part of the [user guide](user-guide.md).

## Connect Google

1. Open **Settings → Connectors** and choose **Connect Google**. Orglet opens your browser at Google's sign-in page.
2. Choose **Allow**.
3. Back in Orglet, the question **Which orglets may use Google?** lists every orglet, all ticked. Untick any you do not want, then choose **Done**.

That is all. You never make a Google Cloud project or an OAuth client: Orglet signs in with CodePawl's own Google client. One sign-in covers all six services, so the row says **Google** with **Sheets · Drive · Docs · Slides · Calendar · Gmail** under it, one **Connected** mark, and one **Disconnect**. While the browser is open the row says **Waiting for the browser…** with **Cancel**; a sign-in you do not finish stops after five minutes.

Each service is still an ordinary server in **Settings → MCP**, and every call an orglet makes still asks you in the chat. **Done** only decides which orglets may use the servers; you can change it later in an orglet's **Permissions** tab, under **MCP servers**.

**Disconnect** asks once, then removes all six servers and the sign-in saved on this computer. If Google needs you to sign in again (the sign-in was revoked, for example), the row shows **Sign in to Google again**.

### How the sign-in works

Google asks for a client secret when an app trades its code for tokens, and a secret cannot be kept safe inside a desktop app. So the app holds only CodePawl's public client ID. Its two token requests (the code exchange at sign-in, and each refresh) go to a small CodePawl service, `connect.orglet.codepawl.com`, which adds the secret and passes Google's answer back unchanged. It keeps nothing and writes no token, code or request body to its logs; the code is in [services/connect](../services/connect/README.md).

Orglet asks for the permissions the six services need together (for example `spreadsheets`, `drive.file` and `gmail.compose`), once, and asks for offline access so the sign-in lasts longer than an hour. Each of the six servers keeps its own copy of the sign-in and refreshes it by itself. Google does not replace the refresh token when it is used, so one server refreshing never breaks another.

The sign-in always comes back to `http://127.0.0.1:53127/callback`. If another program is using port 53127, the sign-in stops and says the fixed port is busy. Close that program and try again.

### Use your own Google client (advanced)

Choose the menu on the Google row, then **Use your own Google OAuth client**, if you would rather use your own Google Cloud project. You make an OAuth client of type **Web application**, tick **Use this client for an AI-powered agent**, add `http://127.0.0.1:53127/callback` to its **Authorized redirect URIs**, add your email to **Test users**, and paste its **Client ID** and **Client secret** into the form. Orglet then signs in to Google directly with your client, without the CodePawl service, the next time you connect. **Use CodePawl's client** in the same menu goes back.

## Other services

For Linear, Notion and Atlassian, choose **Connect** on the service, approve Orglet in the browser, and go back to the app. The row shows **Connected**. GitHub takes a token instead: **Add token** opens the form with the address filled in. Then open an orglet's **Permissions** tab, tick the service under **MCP servers**, and choose **Save orglet**.

## Where things are kept

- CodePawl's Google client ID is public and part of the app. The client secret is not in the app, in your backups or on your computer; it lives only as a secret of the CodePawl service.
- A client you enter yourself is encrypted with your system's secure storage (DPAPI on Windows, Keychain on macOS) in a file beside the API keys. The window can read the Client ID back, never the secret.
- A connected service's tokens are stored with the server's other secret values, as in [MCP servers](mcp.md#how-it-works).
- None of this goes into backups, crew templates or sync. The servers themselves (name and address) are ordinary MCP server records.

## What it cannot do

- Google Chat (`chatmcp`) is not offered yet.
- Slack and other services that only accept an app registered by their company are not offered until CodePawl registers one.
- The row does not show which Google account is connected: that needs one more permission, which Orglet does not ask for.
- The Google sign-in has been checked against a stand-in for Google and for the CodePawl service, not against Google itself. Google's Workspace servers are a developer preview, and an app Google has not verified shows a warning screen and works for up to 100 test users, so the first real sign-in is the first real check.
