# Product direction

Decided with An on 2026-09-17. Use this page to settle product questions before building; change it when a decision changes.

## One line

Orglet is a desktop app where you keep a small team of AI workers, give them work in plain chat, and let them run on the AI subscriptions you already pay for, with your files and history staying on your computer.

## Who it is for

1. **People who work alone.** Freelancers, creators and solo founders who have more to do than time, and want help that remembers how they like things done.
2. **Everyday users.** People comfortable with ChatGPT or Claude who want something more organized, without learning agent frameworks, prompts or APIs.

Orglet is not built for companies that need shared accounts, permissions or admin controls. That can come later if the open-source community wants it.

## Why pick Orglet over a chat app

All four of these matter. When two conflict, the order below breaks the tie.

1. **A team with roles.** Each worker has a name, avatar, instructions and a skill. You talk to one worker, a few of them, all of them, or a team, and they can see what the others said.
2. **Your existing AI plan.** Workers can run through Claude Code or Codex using the account you are already logged in to, so there is no extra API bill. An API key is optional.
3. **Private by default.** No Orglet account. Chats, workers and files live in a local database. A worker reads only the files you attach to that task.
4. **Repeat work runs itself.** Routines send the same request daily or weekly while the app is open. If the machine was off, the schedule is still there: missed runs become one catch-up choice, not a vanished calendar.

## How it should feel

- **A chat first.** A task is a conversation. Workers answer like coworkers, and a formal report only appears when you ask for one or a team checklist needs it.
- **Documents like attachments.** A report arrives as a file you open, not a wall of text in the chat.
- **Quiet while working.** Show a spinner and a short status. Versions, paths and costs live in Details.
- **Nothing to set up to start.** New installs speak US English, include a demo worker and pick avatars and titles automatically. Vietnamese and UK English are in Settings.
- **Clear about limits.** Answers can be wrong. The app says so once, plainly, and never hides where an answer came from.

## Words we use

| In the app | Meaning |
|---|---|
| Task (Công việc) | One conversation with one or more workers |
| Worker (Nhân viên) | An AI coworker with a role, instructions and a skill |
| Team (Nhóm) | Workers who take a message together and combine their results |
| Routine (Lịch chạy) | A request that repeats on a schedule |
| Skill / Knowledge | Reusable instructions and notes workers can use |

Projects that group several tasks are postponed until real use shows a need (shared files or shared context across tasks).

## Release

- **Open source under AGPL-3.0, with a CLA.** The repository is public. Contributors sign the CLA so the project can also sell commercial licenses or be acquired later. Parts meant for reuse, such as the UI components, can be released under a more permissive license later.
- **Every device.** Orglet is for Windows, macOS and Linux, and later iOS and Android. Windows is built and tested first. macOS has unsigned ZIP packaging and a `macos-latest` typecheck/test/make job; that job is not the required merge check. Linux packaging is still later. Public Windows 0.2.x installers stay unsigned; see [windows-release-gates.md](windows-release-gates.md) and [macos-packaging.md](macos-packaging.md).

## Not now

- Company simulation, org charts or agents that run a business
- Cloud sync, accounts or running while the computer is off
- A skill marketplace or running downloaded scripts
- Promising that every provider or subscription works the same way
