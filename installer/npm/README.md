# @codepawl-hq/orglet

Install [Orglet](https://orglet.codepawl.com) from a terminal, then use its `orglet` command.

```sh
npx @codepawl-hq/orglet
```

On Windows this downloads the latest Setup from [GitHub Releases](https://github.com/codepawl/orglet/releases/latest), checks that it matches the release byte for byte (SHA-256) and that it is signed by Open Source Developer Xuan An Nguyen, then runs it. Setup installs Orglet for your Windows user without an administrator prompt, adds the `orglet` command to your PATH and opens the app. If either check fails, nothing is installed.

macOS and Linux are not covered yet. The command points you to the releases page instead.

## After installing

Once Orglet is installed, this package passes every command on to the app's own `orglet` command, so these two behave the same:

```sh
npx @codepawl-hq/orglet status
orglet status
```

`npx @codepawl-hq/orglet install` installs or updates to the latest release at any time. `--yes` skips the question.

What the command can do is in the [terminal guide](https://github.com/codepawl/orglet/blob/main/docs/cli.md).

Licensed under AGPL-3.0.
