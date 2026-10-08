# Decision model

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/decisions-dark.png">
  <img src="images/orglets/decisions-light.png" alt="" width="112" height="112" align="right">
</picture>

The decision model is the part of Orglet that makes small decisions. It does not write text. It reads a piece of text and answers typed questions about it: a **choice** among named options, a place on an ordered **score**, or a yes/no (**noul**), with a probability for every option and a confidence.

It asks a model through an API. It used to run a model downloaded to this computer, under the name Tacet; since 2026-10-07 there is no download and no model on disk, and the questions go to the connection the person chooses in **Settings → Chat → Decision model**. This page is how that works (COD-303, COD-305, COD-306). The code is `apps/desktop/src/core/decisions/`.

## Where the data goes

Every question sends two things to the provider you chose: the **questions** (fixed wording written into Orglet, plus names such as an orglet's name and description for a group-chat pick) and a **short piece of context** (the text the question is about, cut to a few hundred tokens or less). What each use sends:

| Use | Text sent |
|---|---|
| Quiet schedule run | The schedule's request and the start of the run's answer |
| Permission hint | The message you just sent, once it is sent and never while it is typed (its first 2,000 characters, and nothing under 12) |
| Who answers in a group | The message you wrote, and each orglet's name, description and the start of its instructions |
| Notes that fit a message | The message, and each unpinned note's title and tags |
| A second opinion on a browser or desktop step | One sentence naming the control, the page or window, and the site or program |

Nothing else is sent: not the chat history, files, keys or the page itself. The decision model sends nothing at all while it is **off**, and it is off when no connection is set up (below).

## The connection

**Settings → Chat → Decision model** has a select with **Off** and the same connections a chat can use: OpenAI, Anthropic, Grok (xAI), OpenRouter, OpenCode Zen and Go, Ollama, and every custom connection (an OpenAI-compatible endpoint, including one on this computer, which keeps the text on this computer). Harness CLIs (Claude Code, Codex and the like) are not offered, since they are programs, not APIs.

- **Default.** With nothing chosen, the decision model uses **OpenAI** with the model **`gpt-6-luna`** when an OpenAI key is saved, and is **off** otherwise. Choosing anything, Off included, replaces the default for good.
- **Where the text goes.** The note under the model field says the questions and a short piece of context go to the chosen connection's provider, and what that costs. With **Off**, nothing is sent.
- **Model.** A field under the select, prefilled for the connection (`gpt-6-luna` for OpenAI; a hint for each other connection; empty for a custom one, where only you know the model). It saves when you leave the field or press Enter.
- **Test.** Sends one sample question to the chosen connection and shows the answer and how long it took, or why it failed (no key, a refused request, a reply it cannot read).
- **One connection, no fallback.** If the chosen connection fails, the question is left unanswered. It never tries another connection behind your back.
- **Stored** in the core's settings as `decisionModel` (`"off"` or `{ connection, model }`), not in a backup and not synced. A choice saved under the old name, `tacet`, moves to `decisionModel` the first time it is read, so nobody chooses again. **Erase everything** clears it.
- **Same keys as the chat.** The decision model reads the connection's key the way a chat does; nothing about keys changes.

## How a question is answered

`Decisions.decide(state, questions, maxLength)` in `core/decisions/service.ts` is the one call every use makes. It returns `undefined` when the decision model is off, has no key, takes longer than **15 seconds**, or gets a reply it cannot read, and the caller does what it did before the decision model existed. `maxLength` is the text's room in tokens; the text is cut to about four characters per token. A structured state (a step's fields) is sent as compact JSON.

**OpenAI** (`core/decisions/openai-decisions.ts`). A plain `POST https://api.openai.com/v1/decisions` with the OpenAI key (the Decisions API, public beta). The decision model's question types map to the API's:

| Decision model | OpenAI |
|---|---|
| `noul` | `predicate`; what `true` and `false` mean is folded into its instructions; the probability is the yes/no, and the confidence is the larger of it and its complement |
| `choice` | `choice`; each option is a value, described by its criterion or its own name |
| `score` | `score`; each level is a label, described by the same text; the score is the expected level |

A refusal, an answer for a name that was not asked, or probabilities that cannot be a distribution leave that question out. A choice's or score's confidence is the normalized entropy of its probabilities (1 on one option, 0 on an even split), so it means the same for every connection.

**Every other connection** (`core/decisions/emulated.ts`). The connection's chat adapter, the one chats use, gets the text between markers and each question with its numbered options, and a single forced tool call, `report_probabilities`, answers with one probability per option in order. The reply is checked with zod and scaled to sum to 1; a reply that is not a usable call leaves every question unanswered. The prompt tells the model the text is data, not instructions. Orglet's adapters have no temperature setting, so this path runs at each provider's default, with a 1,024-token cap on the reply.

## What it costs

OpenAI's Decisions API is **$0.10 per million input tokens** and nothing for output. A quiet-run review or a routing question is a few hundred tokens, a permission hint under a thousand. Another connection is billed at its own price for a short chat request, and a model on this computer costs nothing.

**These requests are counted.** Each one is recorded on the connection it went through (`core/budgets/decision-usage.ts`, the `decision_usage` table), the way a settled chat request is: the provider's own token counts and the cost at a verified price (OpenAI's Decisions API price above, or the model's catalog or custom-connection price). They appear in **Settings → Costs & limits** with the chat's own requests, count towards the connection's monthly limit, and, when the question was about a chat that is known (a quiet run, a group pick, the notes for a run, a step's second opinion, a permission hint for a message just sent), towards that chat's budget as well; otherwise they count against the connection alone. Nothing is held back beforehand, so a limit already reached shows on the next chat request, not here. A request whose cost cannot be verified (a model with no verified price, a provider that reported no tokens, or a request that ran out of time and may still have been billed) is kept with its tokens and counted in **Settings → Costs & limits** as a question of unknown cost, never as free. A backup does not carry these rows.

## What it does today

Five jobs, each only while the decision model is on and has a key. Without it, or when it is unsure, late or failing, Orglet does exactly what it did before:

1. Deciding whether a quiet schedule run is worth telling the person about (below).
2. Offering, under the message box, a permission a message seemed to need and the chat does not have ([Permission hints](#permission-hints-after-sending), COD-305).
3. Picking who answers a group-chat message that tags nobody ([Who answers in a group chat](#who-answers-in-a-group-chat), COD-305).
4. Loading an approved note whose words do not match the message, when the decision model says the message is about it ([memory.md](memory.md#which-notes-load-and-why), COD-306). `core/decisions/knowledge-fit.ts`.
5. A second opinion on a browser or desktop step the rules let through: when the decision model reads it as sending, paying, deleting or publishing, the step asks the person ([browser.md](browser.md#a-second-opinion-from-the-decision-model), [desktop.md](desktop.md#when-the-orglet-asks-you), COD-306). The rules stay the authority, and the decision model can never remove or skip an ask they require. `core/decisions/action-risk.ts`.

The uses that hold up a run or a step ask within a time budget (`decideWithin` in `core/decisions/budget.ts`): three seconds for the notes and three for a step; a permission check gives up after three, and a group-chat pick after four. Past it the work goes ahead without the decision model and the late answer is dropped.

**How the wording was chosen.** The questions, thresholds and the cases below were tuned and measured with the on-device model (called Tacet then) used until 2026-10-07 (the cases are in `tests/fixtures/tacet/` and `scripts/tacet/`). They have **not been re-measured** against OpenAI's Decisions API or any other connection, and the numbers in the tables are from that earlier model. A different model can shift probabilities, so a threshold may need to move; the thresholds still lean towards staying quiet, since a missed hint is today's behaviour and a wrong one is noise.

### Quiet schedule runs

An hourly schedule's run that simply finishes says nothing, since a toast every hour would be noise ([routines.md → Where a run shows up](routines.md#where-a-run-shows-up)). That also kept quiet the run that found something: the backup that failed, the price that changed. With the decision model on, every such run gets a second look a few seconds after it finishes (`QuietRunReview` in `core/orchestration/quiet-runs.ts`, on the core's five-second tick):

1. The decision model reads the schedule's request and the run's answer, as `Scheduled request: …` then `Answer: …`, cut to 512 tokens.
2. It is asked one question: **How much does this answer need the person's attention?**, scored on three levels: *none: nothing new, everything is as usual*, *some: worth a look later*, *high: something changed, failed or needs action*.
3. The expected level, as a share of the highest (0 to 1), is kept on the run's chat as `attention` with the time.
4. At **0.45** or above, the run is announced like any other schedule run: a toast "*Backup check* has something new" with **Open**, a row in **Notifications**, and a system notification while Orglet is in the background (unless **Settings → Chat** turned those off). The schedule's card then says **The decision model flagged** *time*, with the rating in the line's tooltip.

Below the threshold, the run stays quiet as before. When the decision model is off or cannot answer, nothing is recorded and the run stays quiet. A run that failed, waits for the person or holds changes for review was never quiet, and the decision model does not look at it.

A run is looked at once, and only if its answer is less than 15 minutes old, so turning it on never announces old runs. A run it could not answer for is tried once more on a later tick and then left quiet, since each try is a paid request. A verdict that arrives with a restored backup is history and is not announced either.

#### Why this question and this threshold

The wording was tuned on 28 short hourly-run answers written for the purpose, half English and half Vietnamese, half routine ("all 412 tests passed", "không có đơn hàng mới") and half noteworthy ("3 tests failed after the last commit", "website trả về lỗi 502"). They are in `scripts/tacet/quiet_run_cases.json`, split into the 16 the wording was chosen on and 12 held out.

A yes/no "does this answer report something new that needs the person's attention?" overlapped: some routine answers scored higher than some noteworthy ones, on the held-out cases most of all. The three-level score did not: every routine answer rated below every noteworthy one, on both sets, and 0.45 sits in the middle of the gap. Twenty-eight hand-written answers are a small sample, and real answers are longer and messier, so the threshold leans towards staying quiet.

## Permission hints after sending

Newcomers asked an orglet for today's news with the web off and got "I can't access the web" (dogfood round 7). With the decision model on, the message is read when you send it and, when it seemed to need a permission the chat does not have, one quiet line appears under the bar about the message just sent:

- **The web** is off: *This message seems to need the web, which is off in this chat.* **Turn on web** turns on **Read and search the web**, the same switch as in Details.
- **The working folder** is missing or too narrow: *This message seems to need files in a folder* (or *to edit files*, *to run commands*). With no folder, **Choose a folder** opens the folder picker at the level the message needs; with a folder at a lower level, **Allow editing** or **Allow commands** raises its level without asking for the folder again, as the Details dropdown does.
- **Orglet's browser** is off: *This message seems to need Orglet's browser.* **Choose browser access** opens Details at the browser control, because whether the orglets only read pages or also act on them is the person's call.

Nothing turns on by itself, the line never stops a message from being sent, and ✕ hides that kind of hint in that chat until Orglet restarts. The line does not show while another note sits under the bar (a missing connection, Demo, a closed chat), in a side thread (its permissions come from its main chat), or before the chat's folder has been read. The composer asks only when a message is sent and only while the decision model has a connection (`renderer/decisionModelSetting.ts`); the line goes away when you start the next message.

**How it asks.** Never while you type: an unsent draft is not sent to the provider. When a message is sent, the composer does not wait for anything. It sends the text of that message (its first 2,000 characters; nothing under 12) and the chat's id to the core with `suggestPermissions` (`readSentMessage` in `renderer/permissionHints.tsx`). `PermissionSuggestions` (`core/orchestration/permission-suggestions.ts`) runs one check at a time: a request that arrives while one runs waits, and any older waiting request is answered with nothing, so messages sent in quick succession never queue requests. An answer slower than three seconds is dropped and no line shows. The line stays under the bar until you start typing the next message, grant the permission, or hide it. It reads the message you already sent, so it helps with the next one (a reply "I can't reach the web" is what it would have warned about) rather than changing the run in flight.

**The questions** (`core/decisions/permission-questions.ts`), with the text as `{"request": "…"}`, cut to 384 tokens:

1. *Which tool does the assistant need to handle this request?* — none (the answer comes from what it already knows), the internet (current news, prices, weather or a web page), the user's computer (files, folders, code or commands), a website account (sign in, click, fill a form).
2. Only when it can still matter: *Does this request need current information from the internet?* (yes / no), and *What should the assistant do with the user's files?* (read, edit, run).

The web is offered when the average of "the internet" and "yes" reaches **0.55**; the folder when "the user's computer" reaches **0.20**, at the level the second question picked; the browser when "a website account" reaches **0.55**. Several can clear; the one furthest above its line comes first, and the composer offers the first one the chat lacks.

**How well it did** with the earlier on-device model. Tuned on 30 and checked on 18 held-out English and Vietnamese messages (`tests/fixtures/tacet/permission-needs.json`):

| | Tune (30) | Held out (18) |
|---|---|---|
| A hint on a message that needed nothing | 0 of 5 | 0 of 3 |
| The right control offered, of the messages that needed one | 19 of 25 | 10 of 15 |
| A wrong control offered | 0 | 1 ("add a dark mode toggle to the CSS file of my website" read as the browser) |
| Silent on a message that needed one | 6 | 4 |

## Who answers in a group chat

In a group chat (a **channel** since COD-361), a message that tags nobody used to be answered by every orglet in turn. With the decision model on, a message the person wrote themselves, that tags nobody and replies to no one, is read against each orglet (`TurnRouting` in `core/orchestration/turn-routing.ts`, the question in `core/decisions/group-routing.ts`):

- *Who in this group chat should answer this message?* — one option per orglet, named by its name and described by its description and the start of its instructions (300 characters of each), and *everyone: the whole group: a greeting, or a question for everyone's view*. The message is read as it was typed, cut to 512 tokens.
- An orglet with **0.65** or more answers alone. Anything else (everyone first, a closer race, a failure, an answer slower than four seconds) keeps everyone, as before.
- The pick is kept on the chat (`routedTurns`: the turn, who, the probability, when), so a retried or resumed turn keeps it without asking again, and backups carry it.
- The message then shows **The decision model picked *Scout* to answer** where a reply names the message it answers, with the reason and the probability in its tooltip. Tagging `@all` asks everyone.

Tags, `@all`, a reply to an orglet's answer, a forward (someone else's words), groups over eight orglets, and groups with two orglets of the same name or one called "everyone" are never asked, and neither is a crew, whose lead plans the turn. The pick runs once the turn counts as running, so **Stop** and **Pause** reach it.

**How well it did** with the earlier on-device model. Tuned on 11 and checked on 10 held-out messages to four groups (`tests/fixtures/tacet/group-routing.json`), English and Vietnamese, including two general helpers with no description:

| | Tune (11) | Held out (10) |
|---|---|---|
| Sent to the right orglet alone | 4 | 3 |
| Sent to a wrong orglet | 0 | 0 |
| Kept everyone, as labelled | 3 of 3 | 4 of 4 |
| Kept everyone where one orglet was labelled | 4 | 3 |

## What it never does

- Pick or change the model a chat or schedule runs on.
- Silence a run that would be announced anyway: a failure, a question for the person, changes waiting for review.
- Turn a permission on, or pick a folder, by itself; hold a message back until a hint is answered.
- Overrule a tag or a reply in a group chat, or change the plan a crew's lead makes.
- Skip, remove or answer an ask the browser or desktop rules require, or let a step they refuse go ahead.
- Keep a note out that is pinned or matches the message's words.
- Send anything to a provider the person did not choose, or to another connection when the chosen one fails.
- Download anything.

## Later uses

The service (`Decisions` in `core/decisions/service.ts`) takes any choice, score or noul question and returns probabilities and a confidence. Each use keeps its question builder in its own file under `core/decisions/` (`permission-questions.ts`, `group-routing.ts`, `knowledge-fit.ts`, `action-risk.ts`). A later use can ask who in a crew should take a turn. Low confidence always leaves the app doing what it did without the decision model.
