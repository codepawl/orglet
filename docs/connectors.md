# Connectors

Connectors are the services an orglet can reach after you sign in to them in your browser: Google Sheets, Drive, Gmail, Calendar, Docs and Slides, plus Linear, Notion, Atlassian and GitHub. Each one is an ordinary [MCP server](mcp.md) that Orglet sets up for you, so the choice of which orglet may use it, the approval of every call and the limits are the ones described there.

Part of the [user guide](user-guide.md).

## Connect a service

1. Open **Settings → Connectors**.
2. Choose **Connect** on the service. Orglet opens your browser at the service's sign-in page.
3. Approve Orglet there and go back to the app. The row shows **Connected**. While the browser is open the row says **Waiting for the browser…** with **Cancel**; a sign-in you do not finish stops after five minutes.
4. Open an orglet's **Permissions** tab, tick the service under **MCP servers**, and choose **Save orglet**.

**Disconnect** removes the server and the sign-in saved on this computer. GitHub takes a token instead: **Add token** opens the form with the address filled in.

## Google needs your own OAuth client

Google's Workspace servers are a developer preview, and Google lets an app sign in to them only with an OAuth client made in advance. CodePawl does not ship one yet, so you make one in your own Google Cloud project, once. The same client serves all six Google services.

1. In the Google Cloud Console, create or pick a project.
2. Join the Google Workspace Developer Preview Program with your Google account.
3. In Google Auth Platform, under **Audience**, add your own email to **Test users**. An app that Google has not verified works for up to 100 test users and shows a warning screen when you sign in.
4. Create an OAuth client of type **Web application** and tick **Use this client for an AI-powered agent**.
5. Add this address to **Authorized redirect URIs**, exactly as written:

   `http://127.0.0.1:53127/callback`

6. In Orglet, choose **Connect** on a Google service (or **Enter client** on the **Google OAuth client** row), paste the **Client ID** and **Client secret**, and choose **Save and connect**.

Orglet asks for the permissions each service needs, for example `spreadsheets` and `drive.file` for Sheets, and asks for offline access so the sign-in lasts longer than an hour. The **Google OAuth client** row shows the saved Client ID; its menu has **Edit** and **Delete**. Services already connected keep working after you delete the client, but signing in to one again needs a client.

If another program is using port 53127, the sign-in stops and says the fixed port is busy. Close that program and try again.

## Where things are kept

- The Client ID and Client secret are encrypted with your system's secure storage (DPAPI on Windows, Keychain on macOS) in a file beside the API keys. The window can read the Client ID back, never the secret.
- A connected service's tokens are stored with the server's other secret values, as in [MCP servers](mcp.md#how-it-works).
- None of this goes into backups, crew templates or sync. The server itself (its name and address) is an ordinary MCP server record.

## What it cannot do

- Google Chat (`chatmcp`) is not offered yet.
- Slack and other services that only accept an app registered by their company are not offered until CodePawl registers one.
- The Google sign-in has been checked only against a stand-in service, not against Google itself, so your first sign-in is the first real check.
