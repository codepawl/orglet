# Mobile

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/mobile-dark.png">
  <img src="images/orglets/mobile-light.png" alt="" width="112" height="112" align="right">
</picture>

**Status: proposed, not decided.** Nothing is being built. This page exists so "coming soon" stops standing in for a plan, and so the four questions that block any mobile work are written down with a recommended answer each.

## Why mobile is not a port

A worker runs through a local CLI harness — Claude Code, Codex, Cursor Agent, Gemini CLI — or through an API key held in the desktop machine's secure storage. A phone runs none of that. It cannot host a worker, and Orglet has no server to host one for it ([capabilities.md](capabilities.md)).

So mobile is a **companion to a desktop workspace**, not a second copy of the app. Every question below follows from that.

## The four questions

### What it is for

Recommended: **reading and replying, not starting work.** You sent a worker something before leaving, and on the bus you read the answer and reply to it. Creating workers, teams, schedules, skills and sources stays on the desktop, where the files are.

That keeps the surface to one chat list and one chat, which is a few weeks of work rather than a year.

### How the phone reaches the workspace

Recommended: **the desktop app serves it over the local network, pairing by QR code**, with the phone holding a token the desktop can revoke. Same Wi-Fi only, to start.

The alternative is a relay the user hosts. It works away from home, and it is a server, a deployment, a TLS certificate and an attack surface — for a product whose whole pitch is that there is no Orglet server. Do not build it to save one bus ride.

### When the desktop is asleep

Recommended: **say so plainly and let the reply queue.** The phone shows the workspace as offline, keeps what you typed, and sends it when the desktop is back. Never pretend a worker is thinking when nothing is running.

Push notifications need a server, so there are none in this shape.

### What it is built with

Recommended: **a small web app served by the desktop app**, opened in the phone's browser and added to the home screen. It reuses the renderer's components and needs no store account, no review, no separate release train.

React Native and Capacitor both buy native shell features — push, background, a store listing — that this shape has no use for yet. Revisit if the relay is ever built.

## What would have to be true first

- A read path in the core that a second client can call, separate from the desktop's own IPC.
- Pairing and revocation that a person can understand from the Settings screen.
- A decision that local-network-only is enough for a first version.

## Next

An decides whether the companion shape above is the one to aim at. If yes, these become build issues and this page becomes the design note. If no, the README line goes back to saying nothing is planned.
