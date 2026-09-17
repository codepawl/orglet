# Security policy

## Supported versions

Orglet has no stable release yet. Security fixes go to the `main` branch.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through [GitHub security advisories](https://github.com/codepawl/orglet/security/advisories/new), or email legal@codepawl.com. Include what you found, how to reproduce it and what an attacker could do with it.

You will get a reply within 7 days. Once a fix is ready, we publish an advisory and credit you unless you ask us not to.

## What counts

Orglet runs on your own computer and handles API keys, local files and AI tool processes. Reports we especially want:

- API keys or other secrets leaving secure storage, reaching the interface, logs or backups
- A worker reading files that were not attached to its task
- Requests reaching a provider the user did not choose, or without consent
- Running commands or code the user did not approve
- Backups or imported data that can take control of the app
