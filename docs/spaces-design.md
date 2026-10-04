# Spaces, categories and channels: design

**Status: built, except a marketplace listing for a space.** How it works is in [team-chat.md](team-chat.md#spaces). Asked for by the owner on 2026-10-04: "take the idea of making a server like Discord, then split it into channels and categories, or leave a channel outside the server. Each category and channel can let different orglets in to see it and work with the user." The owner agreed to this plan on 2026-10-05.

The working name here is **space**. The owner said "server". The [README](../README.md) promises that no Orglet server holds your work, so the same word for a group of channels confuses people. The name is the first open question below.

## What changes for the person

Today a channel is the group. Each channel keeps its own list of orglets, and a category is only a label that sorts channels in the sidebar.

After this change there are three levels:

- A **space** is a named group with its own orglets, for example "Launch" or "Client A". It holds categories and channels.
- A **category** is a name inside a space that holds channels. It can narrow which of the space's orglets are in its channels.
- A **channel** is a chat. It sits in a category, directly in a space, or outside every space, as channels do today.

An orglet is **in** a channel when the channel, its category and its space all let it in. An orglet in a channel answers there, takes an `@` tag there, and reads that channel's history when it answers. An orglet that is not in a channel does none of these.

Direct messages do not change. An orglet is still your friend first, and it can be in many spaces.

## Who is in a channel

Access narrows from the top down, the way Discord's does:

1. The space lists its orglets.
2. A category either takes every orglet of its space, or lists some of them.
3. A channel either takes every orglet of its category (or of its space when it has no category), or lists some of them.

A channel outside every space keeps its own list, as now.

Two rules keep this predictable:

- **Nothing widens.** A category cannot hold an orglet its space does not have. A channel cannot hold an orglet its category does not have.
- **Removing cascades.** Taking an orglet out of a space takes it out of every category and channel in that space. Its messages stay, and it stays your friend.

A channel where a lead splits the work keeps its lead and its limits on the channel, as now. The lead must be in the channel. The limit of eight working orglets still applies to that channel.

## What an orglet sees

"In a channel" means the orglet reads that channel's history when it answers. It does not read the other channels of the space. This matches how a channel hydrates a turn today ([chat context](team-chat-context.md)), so cost per message does not change.

Memory stays with the orglet, as now. A note learned in one space is available to that orglet in another. A switch for memory that stays inside one space is left for later, and is listed under Open.

Permissions, the working folder and MCP grants stay on the channel's chat. A space gives no access by itself. Space-level defaults for a new channel are phase 4.

## Data

- **The settings row `spaces`**, beside the one for empty channels. A space holds `id`, `name`, `color`, `orgletIds` and `categories` (`id`, `name`, optional `orgletIds`). A table of its own, with revisions, comes with sync in phase 4.
- **`Channel` record** ([`shared/channels.ts`](../apps/desktop/src/shared/channels.ts)) gains `spaceId` and `categoryId`, both optional, and `access`: `inherit` or `listed`. With `listed`, `members` is the list, as today. The `category` string stays for channels outside a space.
- **`assignees` stays the resolved list** on the chat's row. The runner, `@` tags, Tacet's routing, permissions and the Running view read a channel as they do now. Core resolves the list again when a message is sent and when a space, category or channel is edited. An edit is refused while that channel is working, as `updateChannel` is today.
- Every new field is optional JSON on the channel's record. A channel whose space is missing reads as a channel outside every space, with the members it last resolved.
- Zod contracts at the IPC edge: `createSpace`, `updateSpace`, `deleteSpace` and `spaceFromCategory`. `updateChannel` with a `spaceId` moves a channel in, and `spaceId: null` moves it out.

## Migration

Nothing moves by itself. Existing channels stay outside every space with their category labels, and work as they do now.

A category of loose channels gets one action: **Make a space from this category**. It creates a space named after the category, whose orglets are every orglet of those channels. Each channel keeps its own list as `listed`, so no orglet gains a channel it did not have.

## The shell

- **Rail.** Home comes first, then one tile for each space, with its initial on its colour. The `#` tile follows when channels outside a space exist. Activity, Library and Schedules stay last. The **+** menu gains **New space**.
- **Sidebar.** For a space: its name with a menu (settings, members, new category, new channel), then its channels under their categories. A channel that lists its own orglets shows a lock before its name.
- **Member column.** The orglets in the open channel, with the person first. In a space, its other orglets follow in a second, dimmed group. Their menu has **Add to this channel**.
- **Space settings.** One dialog: name and colour, orglets, categories. It follows `ChannelDialog`.
- **Moving a channel.** Drag in the sidebar, or **Move to** in the channel's menu. A channel moved into a space keeps only the orglets the space has. The app names the orglets it drops before it moves.

## What does not change

- A chat is still one `tasks` row, and a message is a turn.
- Side threads, schedules, forwarding, reactions, search and notifications work on a channel as now.
- The crew engine and the lead's plan.
- Trust boundaries: an orglet reads only the files attached to that chat or inside its granted folder.

## Phases

Each phase is its own pull request. Each one leaves the app working.

| Phase | What it adds | Proof |
|---|---|---|
| **1. Data and core** | The `spaces` table, the contracts, the new channel fields, resolving `assignees`, the two rules, **Make a space from this category** as a command. No screen changes. Built. | Integration tests for resolving, narrowing, cascading, the refusal while a channel works, and an older row read unchanged. |
| **2. Spaces in the shell** | Rail tiles, the space sidebar, New space, space settings, moving a channel. Channels in a space take every orglet of the space. Built. Moving a channel is in its settings, not a drag. | Packaged smoke: make a space, add a channel, send a message, the right orglets answer. Alignment check with the new screens. |
| **3. Access on categories and channels** | `inherit` and `listed` in the dialogs, the lock mark, the dimmed group in the member column. Built. | Smoke: an orglet outside a channel cannot be tagged and does not answer. |
| **4. Around it** | The `orglet` command (`spaces`, `--space`), backup and restore, the sync projection, a space as a marketplace listing, defaults for a new channel's permissions, user pages. Built: `orglet spaces`, backup and restore, user pages. Also built since: the sync record, permission defaults for a new channel, and dragging a channel to another category. Not built: a space as a marketplace listing, and `--space` on other commands. | Each surface's own tests. |

## Open

1. **The word.** Space, server, group or team. This page says space.
2. **One orglet in many spaces.** This page says yes, because an orglet is a friend first.
3. **Reading history.** This page says an orglet reads only the channels it is in. The alternative is that it reads every channel of its space, which costs more per message.
4. **Memory by space.** Whether an orglet's notes can be kept inside one space.
5. **The Channels area.** Loose channels can keep their own rail tile for good. The alternative is that every channel must sit in a space.
6. **People as members.** [Collaboration](account-sync-design.md) will add people to channels. A space is the natural unit to invite a person to. The `orgletIds` list then becomes members with a kind, as channel members already are.
