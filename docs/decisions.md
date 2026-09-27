# Tacet on this computer

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/decisions-dark.png">
  <img src="images/orglets/decisions-light.png" alt="" width="112" height="112" align="right">
</picture>

Tacet is CodePawl's small decision model ([`codepawl/tacet-sonata`](https://huggingface.co/codepawl/tacet-sonata), 144M parameters, a fine-tuned mmBERT-small, Apache-2.0). It does not write text. It reads a piece of text and answers typed questions about it in one pass: a **choice** among named options, a place on an ordered **score**, or a yes/no (**noul**), with a probability for every option. It reads 16 languages, Vietnamese and English among them.

Orglet can run it on this computer, with no GPU and no account. It is not part of the installer: it downloads only when the person turns it on in **Settings → Chat → Tacet on this computer**. This page is how that works (COD-303). The code is `apps/desktop/src/core/decisions/`.

## What it does today

Three jobs. Each only adds to what Orglet did without Tacet, and each falls back to exactly that when Tacet is absent, fails or is late:

- Deciding whether a quiet schedule run is worth telling the person about (COD-303, below).
- Loading an approved note whose words do not match the message, when Tacet says the message is about it (COD-306): [memory.md](memory.md#which-notes-load-and-why). `core/decisions/knowledge-fit.ts`.
- A second opinion on a browser or desktop step the rules let through: when Tacet reads it as sending, paying, deleting or publishing, the step asks the person (COD-306). The rules stay the authority, and Tacet can never remove or skip an ask they require: [browser.md](browser.md#a-second-opinion-from-tacet), [desktop.md](desktop.md#when-the-orglet-asks-you). `core/decisions/action-risk.ts`.

The two COD-306 uses ask within a time budget (`decideWithin` in `core/decisions/budget.ts`): 1.5 seconds for the notes, one second for a step. A request that runs out of time keeps going in the worker, so a model that was still loading is ready for the next question. `Decisions.warm()` starts loading the model without a question, which a run does when it first uses the browser or a desktop app.

### Quiet schedule runs

An hourly schedule's run that simply finishes says nothing, since a toast every hour would be noise ([routines.md → Where a run shows up](routines.md#where-a-run-shows-up)). That also kept quiet the run that found something: the backup that failed, the price that changed. With Tacet on this computer, every such run gets a second look a few seconds after it finishes (`QuietRunReview` in `core/orchestration/quiet-runs.ts`, on the core's five-second tick):

1. Tacet reads the schedule's request and the run's answer, as `Scheduled request: …` then `Answer: …`, cut to 512 tokens.
2. It is asked one question: **How much does this answer need the person's attention?**, scored on three levels: *none: nothing new, everything is as usual*, *some: worth a look later*, *high: something changed, failed or needs action*.
3. The expected level, as a share of the highest (0 to 1), is kept on the run's chat as `attention` with the time.
4. At **0.45** or above, the run is announced like any other schedule run: a toast "*Backup check* has something new" with **Open**, a row in **Notifications**, and a system notification while Orglet is in the background (unless **Settings → Chat** turned those off). The schedule's card then says **Tacet flagged** *time*, with the rating in the line's tooltip.

Below the threshold, the run stays quiet as before. When Tacet is not downloaded, fails to load or cannot answer, nothing is recorded and the run stays quiet. A run that failed, waits for the person or holds changes for review was never quiet, and Tacet does not look at it.

A run is looked at once, and only if its answer is less than 15 minutes old, so turning Tacet on never announces old runs. A verdict that arrives with a restored backup is history and is not announced either.

### Why this question and this threshold

The wording was tuned on 28 short hourly-run answers written for the purpose, half English and half Vietnamese, half routine ("all 412 tests passed", "không có đơn hàng mới") and half noteworthy ("3 tests failed after the last commit", "website trả về lỗi 502"). They are in `scripts/tacet/quiet_run_cases.json`, split into the 16 the wording was chosen on and 12 held out.

A yes/no "does this answer report something new that needs the person's attention?" overlapped: some routine answers scored higher than some noteworthy ones, on the held-out cases most of all. The three-level score did not: every routine answer rated below every noteworthy one, on both sets, and 0.45 sits in the middle of the gap. Twenty-eight hand-written answers are a small sample, and real answers are longer and messier, so the threshold leans towards staying quiet: a missed announcement is only today's behaviour, while a false one is the noise the quiet runs were made to remove.

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
- Skip, remove or answer an ask the browser or desktop rules require, or let a step they refuse go ahead.
- Keep a note out that is pinned or matches the message's words.
- Download anything the person did not ask for, or from anywhere but the pinned addresses.
- Send what it reads anywhere.

## Later uses

The service (`Decisions` in `core/decisions/service.ts`) takes any choice, score or noul question and returns probabilities and a confidence. Later uses can ask it before a message is sent which capabilities a request needs, or who in a crew should take a turn. Low confidence always leaves the app doing what it did without Tacet.
