# Troubleshooting

Part of the [user guide](user-guide.md). For a bug report, copy **Build details** from **Settings → About** and include it, minus anything private. Questions go to [Discussions](https://github.com/codepawl/orglet/discussions); bugs to [Issues](https://github.com/codepawl/orglet/issues).

## Windows says "Windows protected your PC"

SmartScreen shows this for a signed build whose certificate has not built up a reputation yet. Check that the dialog names **Nguyen Xuan An** as the publisher, then choose **More info → Run anyway**. If it says **Unknown publisher**, the file is not the signed release: delete it and download Setup again from the [Release page](https://github.com/codepawl/orglet/releases/latest).

## A harness shows "Found on disk" or "Sign-in error"

**Found on disk** means the CLI is installed but not signed in. **Sign-in error** means Orglet could not read its sign-in state. In both cases:

1. In **Settings → Local harnesses**, copy the login command the row shows. It uses the exact executable Orglet found, so it works even when the CLI is not on your `PATH`.
2. Run it in your own terminal and finish the sign-in in the browser it opens.
3. Choose **Rescan**.

If the row holds several accounts, the command signs in to the account selected on the row. Orglet never falls back to Demo when sign-in fails; the orglet stays on the harness and the chat says what is missing.

Codex can look signed in with an expired token until a run fails; sign in again and rerun. The Claude desktop app's own session is not reused; Claude Code itself has to be signed in. On macOS, Claude Code may keep credentials in the Keychain, so separate accounts are only verified on Windows.

## A harness is "Not installed" although it is installed

Orglet looks on `PATH`, in `~/.local/bin`, in the npm, bun and volta global folders, and in the places the Claude, Codex and Cursor installers use. Choose **Rescan** after installing. If the CLI lives somewhere else, add it to `PATH` and restart Orglet.

If a run fails saying the executable is no longer where it was found, the install was replaced or updated underneath Orglet: choose **Rescan** and retry.

## "Could not confirm that the harness stopped"

Cancelling a harness run waits for the CLI process tree to end. When it cannot confirm that, the run fails with this message. Open Task Manager, end the remaining `claude`, `codex` or `agent` process, then retry.

## The model list will not load

Type the model ID by hand; the orglet runs with it. The list comes from the provider's own API or CLI and needs a working key or sign-in. See [Connections → Model IDs](connections.md#model-ids).

## The chat says it is waiting for budget

A Claude Code run reached the chat's **Limit per task**. Raise it in the orglet's settings, or in the crew's **Limits & shifts**, and send the next message; the new limit applies to it. For API orglets, check **Settings → Costs & limits** for the monthly limit per connection.

## The chat is blocked by an earlier attempt

A run that was cancelled or interrupted while changing files may have an unknown outcome. The failure card offers **Review in Details**. Check your files, then in **Details → Files and processes** choose **Keep current files** on the blocking attempt. That leaves your files as they are and lets the next run start; it does not apply the old attempt's pending edits.

## A command cannot reach localhost

Commands an orglet runs in a working folder have no network at all, including `127.0.0.1`, `::1` and `localhost`. A server one command starts cannot be reached by the next command, or even by its own process: the connect fails with `EACCES` or `ECONNREFUSED`. This is the sandbox, not a missing permission, and there is no switch for it, because the only way to open loopback would open every local service on your machine to the run.

The orglet is told this when it happens, with the way around it: test in-process. Import the app or its request handler and call it directly, or use a test client that injects requests without opening a socket. Detail: [technical guide → Commands and loopback](technical-guide.md#commands-and-loopback).

## A command cannot find Python, Git or pnpm

Workspace commands do not inherit your `PATH` or shell profile. They run with the bundled Node runtime or Windows `cmd`, inside the working copy. `npm test`, `npm run <name>` and the pnpm and yarn forms run the project's `package.json` scripts with that Node, but nothing can be installed. Tell the orglet what is available, or run that step yourself.

## Web search fails with a verification challenge

Search reads DuckDuckGo's plain results page, which sometimes answers with a human-verification page. The orglet gets that as an error and can read a URL you give it instead. Reading a page needs a public `http` or `https` address; private addresses and pages that need a login are refused.

## The ZIP build does not update

Only a Setup install updates itself. Download the new version from the [Release page](https://github.com/codepawl/orglet/releases/latest), or install with Setup once to get automatic updates from then on. See [Settings → About](settings.md#about).

## A newer build refuses to open the workspace

The database is from a newer schema than the build you started. Use the newer build, or roll back the database from the copy that build saved: [recovery.md](recovery.md).
