# Tacet on this computer

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/decisions-dark.png">
  <img src="images/orglets/decisions-light.png" alt="" width="112" height="112" align="right">
</picture>

Tacet is CodePawl's small decision model ([`codepawl/tacet-sonata`](https://huggingface.co/codepawl/tacet-sonata), 144M parameters, a fine-tuned mmBERT-small, Apache-2.0). It does not write text. It reads a piece of text and answers typed questions about it in one pass: a **choice** among named options, a place on an ordered **score**, or a yes/no (**noul**), with a probability for every option. It reads 16 languages, Vietnamese and English among them.

Orglet can run it on this computer, with no GPU and no account. It is not part of the installer: it downloads only when the person turns it on in **Settings → Chat → Tacet on this computer**. This page is how that works (COD-303, COD-305). The code is `apps/desktop/src/core/decisions/`.

## What it does today

Five jobs, each only while Tacet is downloaded and ready. Without it, or when it is unsure or late, Orglet does exactly what it did before:

1. Deciding whether a quiet schedule run is worth telling the person about (below).
2. Offering, under the message box, a permission a message seems to need and the chat does not have ([Permission hints](#permission-hints-before-sending), COD-305).
3. Picking who answers a group-chat message that tags nobody ([Who answers in a group chat](#who-answers-in-a-group-chat), COD-305).
4. Loading an approved note whose words do not match the message, when Tacet says the message is about it ([memory.md](memory.md#which-notes-load-and-why), COD-306). `core/decisions/knowledge-fit.ts`.
5. A second opinion on a browser or desktop step the rules let through: when Tacet reads it as sending, paying, deleting or publishing, the step asks the person ([browser.md](browser.md#a-second-opinion-from-tacet), [desktop.md](desktop.md#when-the-orglet-asks-you), COD-306). The rules stay the authority, and Tacet can never remove or skip an ask they require. `core/decisions/action-risk.ts`.

The two COD-306 uses ask within a time budget (`decideWithin` in `core/decisions/budget.ts`): 1.5 seconds for the notes, one second for a step. A request that runs out of time keeps going in the worker, so a model that was still loading is ready for the next question. `Decisions.warm()` starts loading the model without a question, which a run does when it first uses the browser or a desktop app.

### Quiet schedule runs

An hourly schedule's run that simply finishes says nothing, since a toast every hour would be noise ([routines.md → Where a run shows up](routines.md#where-a-run-shows-up)). That also kept quiet the run that found something: the backup that failed, the price that changed. With Tacet on this computer, every such run gets a second look a few seconds after it finishes (`QuietRunReview` in `core/orchestration/quiet-runs.ts`, on the core's five-second tick):

1. Tacet reads the schedule's request and the run's answer, as `Scheduled request: …` then `Answer: …`, cut to 512 tokens.
2. It is asked one question: **How much does this answer need the person's attention?**, scored on three levels: *none: nothing new, everything is as usual*, *some: worth a look later*, *high: something changed, failed or needs action*.
3. The expected level, as a share of the highest (0 to 1), is kept on the run's chat as `attention` with the time.
4. At **0.45** or above, the run is announced like any other schedule run: a toast "*Backup check* has something new" with **Open**, a row in **Notifications**, and a system notification while Orglet is in the background (unless **Settings → Chat** turned those off). The schedule's card then says **Tacet flagged** *time*, with the rating in the line's tooltip.

Below the threshold, the run stays quiet as before. When Tacet is not downloaded, fails to load or cannot answer, nothing is recorded and the run stays quiet. A run that failed, waits for the person or holds changes for review was never quiet, and Tacet does not look at it.

A run is looked at once, and only if its answer is less than 15 minutes old, so turning Tacet on never announces old runs. A verdict that arrives with a restored backup is history and is not announced either.

#### Why this question and this threshold

The wording was tuned on 28 short hourly-run answers written for the purpose, half English and half Vietnamese, half routine ("all 412 tests passed", "không có đơn hàng mới") and half noteworthy ("3 tests failed after the last commit", "website trả về lỗi 502"). They are in `scripts/tacet/quiet_run_cases.json`, split into the 16 the wording was chosen on and 12 held out.

A yes/no "does this answer report something new that needs the person's attention?" overlapped: some routine answers scored higher than some noteworthy ones, on the held-out cases most of all. The three-level score did not: every routine answer rated below every noteworthy one, on both sets, and 0.45 sits in the middle of the gap. Twenty-eight hand-written answers are a small sample, and real answers are longer and messier, so the threshold leans towards staying quiet: a missed announcement is only today's behaviour, while a false one is the noise the quiet runs were made to remove.

## Permission hints before sending

Newcomers asked an orglet for today's news with the web off and got "I can't access the web" (dogfood round 7). With Tacet ready, the message box reads what is typed and, when the message seems to need a permission the chat does not have, shows one quiet line under the bar:

- **The web** is off: *This message seems to need the web, which is off in this chat.* **Turn on web** turns on **Read and search the web**, the same switch as in Details.
- **The working folder** is missing or too narrow: *This message seems to need files in a folder* (or *to edit files*, *to run commands*). With no folder, **Choose a folder** opens the folder picker at the level the message needs; with a folder at a lower level, **Allow editing** or **Allow commands** raises its level without asking for the folder again, as the Details dropdown does.
- **Orglet's browser** is off: *This message seems to need Orglet's browser.* **Choose browser access** opens Details at the browser control, because whether the orglets only read pages or also act on them is the person's call.

Nothing turns on by itself, the line never stops a message from being sent, and ✕ hides that kind of hint in that chat until Orglet restarts. The line does not show while another note sits under the bar (a missing connection, Demo, a closed chat), in a side thread (its permissions come from its main chat), or before the chat's folder has been read.

**How it asks.** The composer waits for a 450 ms pause in typing, then sends the text (its first 2,000 characters; nothing under 12) to the core with `suggestPermissions`. `PermissionSuggestions` (`core/orchestration/permission-suggestions.ts`) runs one check at a time: a request that arrives while one runs waits, and any older waiting request is answered with nothing, so fast typing never queues passes. An answer slower than 1.5 seconds is dropped (the first one also loads the model; the load carries on and the next pause finds it ready). While typing continues, the line keeps its last answer until the next one arrives, so it does not blink at every word.

**The questions** (`core/decisions/permission-questions.ts`), with the text as `{"request": "…"}`, cut to 384 tokens:

1. *Which tool does the assistant need to handle this request?* — none (the answer comes from what it already knows), the internet (current news, prices, weather or a web page), the user's computer (files, folders, code or commands), a website account (sign in, click, fill a form).
2. Only when it can still matter: *Does this request need current information from the internet?* (yes / no), and *What should the assistant do with the user's files?* (read, edit, run).

The web is offered when the average of "the internet" and "yes" reaches **0.55**; the folder when "the user's computer" reaches **0.20**, at the level the second question picked; the browser when "a website account" reaches **0.55**. Several can clear; the one furthest above its line comes first, and the composer offers the first one the chat lacks. Asking all of it in one pass changed each answer, and a six-way choice, one yes/no per permission and three-level scores all ranked the labelled messages worse, so these are two passes.

**How well it does.** Tuned on 30 and checked on 18 held-out English and Vietnamese messages (`tests/fixtures/tacet/permission-needs.json`, `scripts/tacet/eval-hints-routing.ts`), on the shipped model file:

| | Tune (30) | Held out (18) |
|---|---|---|
| A hint on a message that needed nothing | 0 of 5 | 0 of 3 |
| The right control offered, of the messages that needed one | 19 of 25 | 10 of 15 |
| A wrong control offered | 0 | 1 ("add a dark mode toggle to the CSS file of my website" read as the browser) |
| Silent on a message that needed one | 6 | 4 |

Two of the right-control hints named the wrong folder level ("find where the login function is defined" as run commands, "summarize the Word files" as edit); the person still chooses in the picker. The web was caught for 5 of 8 messages that needed it, with no web hint on any other message. The thresholds sit just above every tuning message without the need; the web's and the browser's one step higher, after a held-out message without the need scored within 0.01 of the tuning point. Forty-eight messages are a small sample, so the lines lean towards silence: a missed hint is today's behaviour, a wrong one is noise.

**Speed** on the development machine (Ryzen 5 5600X, shared, at 100 % CPU from other work during both runs). In the packaged app, from the window through the core and the worker and back, a whole check (one or two passes) took p50 170 ms, p95 287 ms, at most 340 ms over the 48 labelled messages; the web hint was on screen 0.87 s after the text was typed, 0.45 s of it the pause. The same checks from a script at below-normal priority took p50 251 ms, p95 1.37 s. The 1.5-second limit sits well above both.

## Who answers in a group chat

In a group chat (a **channel** since COD-361), a message that tags nobody used to be answered by every orglet in turn. With Tacet ready, a message the person wrote themselves, that tags nobody and replies to no one, is read against each orglet (`TurnRouting` in `core/orchestration/turn-routing.ts`, the question in `core/decisions/group-routing.ts`):

- *Who in this group chat should answer this message?* — one option per orglet, named by its name and described by its description and the start of its instructions (the model reads 48 tokens of each), and *everyone: the whole group: a greeting, or a question for everyone's view*. The message is read as it was typed, cut to 512 tokens.
- An orglet with **0.65** or more answers alone. Anything else (everyone first, a closer race, a failed load, an answer slower than four seconds) keeps everyone, as before.
- The pick is kept on the chat (`routedTurns`: the turn, who, the probability, when), so a retried or resumed turn keeps it without asking again, and backups carry it.
- The message then shows **Tacet picked *Scout* to answer** where a reply names the message it answers, with the reason and the probability in its tooltip. Tagging `@all` asks everyone.

Tags, `@all`, a reply to an orglet's answer, a forward (someone else's words), groups over eight orglets, and groups with two orglets of the same name or one called "everyone" are never asked, and neither is a crew, whose lead plans the turn. The pick runs once the turn counts as running, so **Stop** and **Pause** reach it.

**How well it does.** Tuned on 11 and checked on 10 held-out messages to four groups (`tests/fixtures/tacet/group-routing.json`), English and Vietnamese, including two general helpers with no description:

| | Tune (11) | Held out (10) |
|---|---|---|
| Sent to the right orglet alone | 4 | 3 |
| Sent to a wrong orglet | 0 | 0 |
| Kept everyone, as labelled | 3 of 3 | 4 of 4 |
| Kept everyone where one orglet was labelled | 4 | 3 |

At 0.60 the counts were the same; a message to two general helpers reached 0.59 for one of them, so the line sits a step above. Vietnamese roles with clear descriptions routed best; English groups whose orglets overlap (a writer and a researcher) mostly kept everyone. A pick of two orglets was not tried: nothing in the labelled set supported it.

Routing took p50 168 ms, p95 304 ms per message on the same loaded machine.

## The download

**Settings → Chat → Tacet on this computer** shows what Tacet does, that it stays on this computer, and its size (about 305 MB). **Download** fetches two files; a bar shows the bytes as they arrive, and **Cancel** stops it. **Remove** unloads the model and deletes its files. The block is its own component (`TacetSetup` in `renderer/components/TacetSetup.tsx`), so an onboarding step can show the same thing.

- **What is fetched.** The model as ONNX (`onnx/tacet-sonata-int8-embeddings.onnx`, 285 MB) and the tokenizer (`tokenizer/tokenizer.json`, 34 MB), from the `codepawl/tacet-sonata` repository on Hugging Face. The tokenizer's address names the commit it was published in. Each file's size and SHA-256 are pinned in the app (`TACET_FILES` in `core/decisions/manifest.ts`).
- **Where it goes.** `models/tacet-sonata/` in Orglet's data folder, beside the database.
- **Verified before use.** Bytes land in a `.part` file. Only a file of the pinned size and SHA-256 is renamed into place; one that does not match is deleted and the block says so. The worker checks both hashes again every time it loads the model.
- **Resumed.** Bytes are written as they arrive, without waiting on the disk between reads, so a connection that drops keeps every byte that arrived, and **Retry** continues from there with an HTTP range request. A server that sends the whole file instead starts it over. Thirty seconds without a byte counts as a dropped connection.
- **Cancelled.** **Cancel** stops and deletes the partial file, since the person asked for it to stop.
- **Erased.** **Settings → Data → Erase everything** deletes the folder too.
- **No other network.** Nothing in the decisions code opens a connection except this download. Asking Tacet happens on this computer.

For the packaged smoke test only, `ORGLET_TACET_SOURCE` can point the download at a server on `127.0.0.1` or `localhost`. Any other address is ignored, and the pinned sizes and hashes still apply, so it changes where identical bytes come from and nothing else.

## Updates

A new Tacet reaches people with an Orglet release: the release pins the new files' sizes and hashes in `TACET_FILES`, and nothing is read from the network to decide that there is one. A model list fetched at run time could swap the model without a release, so there is none.

- **Which Tacet is on disk.** A verified download writes `installed.json` beside the files: each file's name, size and SHA-256. A folder from before that file is taken at its word while its files have the pinned sizes, and gets the record the first time the worker loads it, since loading checks both hashes.
- **Seeing an earlier one.** When the record names other files than this Orglet pins, or a folder without a record holds a finished file of another size, the state is **outdated** (`Decisions.isOutdated` in `core/decisions/service.ts`). Tacet then rests: every use does what Orglet does without it, because a model is not paired with decision code written for another.
- **Telling the person.** Once a launch, a note says *A newer Tacet is available. Tacet is paused until you update.* with **Update**, kept in Notifications, where the newest such row keeps **Update** while the earlier Tacet is still on disk (`tacetUpdateNoticeId`). **Activity → Needs you** offers it too, and the Settings block shows *Update available · 305 MB* with **Update** in place of Remove. Nothing downloads until the person clicks (owner, 2026-10-07).
- **Updating.** **Update** is the same download as the first one: a file whose record matches is kept, the others are fetched and verified, the record is rewritten, and whatever else the folder holds (an earlier file under another name) is deleted. A cut update says so with **Retry**, as a first download does, and stays an update (`update` on the failed state, `tacetUpdateWaiting`), so Needs you keeps it, saying it did not finish, with **Retry**.

## How it runs

- **ONNX Runtime in Node.** The model runs through `onnxruntime-node` on the CPU execution provider. ONNX was picked to run inside Electron without Python, not for speed.
- **Off the core's thread.** It loads in a worker thread of the core (`core/decisions/worker.ts`, built to `decisions.js`), so the core keeps serving the window while a request is answered. It loads on the first question, not at startup, and unloads after two quiet minutes: a schedule runs at most hourly, and 300 MB of memory between runs would be waste.
- **Two threads.** One forward pass uses two CPU threads, so it never takes the whole machine from the person.
- **Speed.** On a 6-core desktop CPU, the first answer takes about two seconds (the hash checks and loading) and each answer after that under 0.1 seconds for a quiet-run check. A long text of 1,536 tokens takes a few seconds, which is why the quiet-run check cuts at 512.
- **Same answers as Python.** `core/decisions/packing.ts` and `decoding.ts` are line-for-line ports of the Python package's `packing.py` and `decoding.py`. `tests/integration/decisions-parity.test.ts` checks them against the Python package's own output on English and Vietnamese requests: the same token ids, segments and option positions, and probabilities within 0.0001. The tokenizer is Hugging Face's `@huggingface/tokenizers` reading the model's own `tokenizer.json`; its Metaspace step ignores `split: true`, so the app rebuilds that split from the library's own pieces (`withMetaspaceSplit` in `core/decisions/tokenizer.ts`).
- **The model file.** `scripts/tacet/export_onnx.py` exports the published weights. The file Orglet downloads keeps every weight in float32 except the 256k-token embedding table, which is int8. Quantizing the matrix multiplications as well made a file half that size but changed answers; the embedding-only file answers within 0.005 of the original on every test request, with no answer changed. Running the script again gives the same weights and the same outputs but not the same bytes (the exporter names its nodes afresh), so the pinned hash belongs to the one file that was uploaded, and a new export means a new hash in `manifest.ts`.

## Packaging

The installer carries ONNX Runtime's native files for its own platform and architecture only, unpacked from the app's archive: on Windows x64, `onnxruntime_binding.node` and `onnxruntime.dll` (29 MB). DirectML and its shader compiler are left out: the CPU provider loads without them. Microsoft signs both files, and the Windows signing step (`forge.windows.ts`) leaves files that already carry a valid signature alone, so its check that every DLL and native addon is signed passes without Orglet's name on Microsoft's files.

## What it never does

- Pick or change the model a chat or schedule runs on.
- Silence a run that would be announced anyway: a failure, a question for the person, changes waiting for review.
- Turn a permission on, or pick a folder, by itself; hold a message back until a hint is answered.
- Overrule a tag or a reply in a group chat, or change the plan a crew's lead makes.
- Skip, remove or answer an ask the browser or desktop rules require, or let a step they refuse go ahead.
- Keep a note out that is pinned or matches the message's words.
- Download anything the person did not ask for, or from anywhere but the pinned addresses.
- Send what it reads anywhere.

## Later uses

The service (`Decisions` in `core/decisions/service.ts`) takes any choice, score or noul question and returns probabilities and a confidence. Each use keeps its question builder in its own file under `core/decisions/` (`permission-questions.ts`, `group-routing.ts`, `knowledge-fit.ts`, `action-risk.ts`), tuned on its own labelled set. A later use can ask who in a crew should take a turn. Low confidence always leaves the app doing what it did without Tacet.
