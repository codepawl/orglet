# Self-improvement

A worker gets better at its job from the feedback it already receives. When you keep asking the same worker to revise, give its answers a thumbs-down, or its reports keep failing a check, its next chat run sees that evidence and may propose **one sentence** for its own instructions. The proposal is a card in the chat, like any other app change. Nothing changes until you click **Apply**.

Decided with An on 2026-09-23 (COD-162). This page is how it works and the decisions behind it. For the other kind of learning, a fact remembered, see [memory.md](memory.md).

## Memory and self-improvement

| | Memory | Self-improvement |
|---|---|---|
| What it is | A fact learned ("prefers short answers", "the quarterly file is report-q3.xlsx") | A change in how the worker works: one sentence in its instructions |
| Who decides | The worker writes it during a chat; you can edit or delete it | The worker proposes it; only your click applies it |
| Where it lives | The knowledge store, on the worker's Memory tab | The worker's instructions, as a new revision |
| Undo | Edit or delete the memory | **Undo** on the card; every apply and undo is a worker revision |

A memory never changes instructions, and a self-improvement never stores a fact. The split is kept in code: memory goes through `remember` and the knowledge store; self-improvement goes through the proposal cards and `saveWorker`.

## What counts as feedback

Only what you did, or what a core check refused. Nothing a model wrote is a signal. Four kinds:

| Signal | What it is | Where it is stored |
|---|---|---|
| Asked to revise | You replied to one of this worker's answers with a new message (the reply arrow in the composer) | The next run's `input.replyTo` names the answer |
| Thumbs-down | You put 👎 on one of this worker's answers | `messageReactions` on the chat, actor `user`, emoji `against` |
| Report refused | The worker's report failed the citation, checker, line-range, process or workspace-evidence gate | The failed run carries `errorCode: 'report_rejected'` |
| Same failure | Two runs failed with the same error text | The failed runs' `error` |

Failures the worker cannot fix are left out: a provider usage limit, and a chat blocked by an earlier attempt with an unknown outcome (`unresolved_attempt`). Two different errors are not one class.

Your own edits to a worker's instructions are not a signal: they already reach the next run, because they are the instructions.

## When a worker is asked

The check is deterministic and runs in the core before a chat run starts (`detectImprovementSignals` in `apps/desktop/src/core/orchestration/self-improvement.ts`, a pure function over stored rows):

1. Take the worker's last **20** runs across all its chats that still exist. Team planning runs are skipped.
2. Count each kind of signal among them. A kind counts only from runs that started after the last self-improvement proposal of that kind, so an applied change gets a fresh count.
3. A kind with at least **2** signals is a signal the run may act on.
4. Nothing is offered while an earlier self-improvement is still waiting for your click, and a kind you dismissed is never offered to that worker again.

The signals are frozen on the run snapshot (`run.snapshot.improvement`) together with the run's context, so a resumed run sees the same evidence and **Details** can show what the worker was told. Only a chat run gets them: a solo or group chat, never a scheduled run, never a team member or lead job, never Demo.

## What the worker sees and may do

The run's brief message carries `selfImprovement`: each signal with its kind, count, the chats it came from, and up to five short notes (the reply you sent, the answer you marked, the error). The instruction beside it says: if one short, concrete sentence in your own instructions would prevent this next time, call `propose_self_improvement` once; do not rewrite your instructions; do not propose anything for another orglet, a skill, a tool, a model or a budget; skip it when the feedback does not point at your instructions; answer the user first.

`propose_self_improvement` has three fields and nothing else:

| Field | Meaning |
|---|---|
| `signal` | Which kind of feedback it answers; must be one the run froze |
| `replaces` | One existing sentence of the instructions, quoted exactly, or `null` to add at the end |
| `sentence` | The new sentence, at most 400 characters |

The schema is strict, so a `targetId`, a `name`, a `provider`, a `modelId`, a `skillId` or a budget is an unknown field and the call is refused before anything is stored. The sentence to replace has to occur exactly once; a wrong quote or an unknown signal goes back to the worker as the tool's answer and the run goes on.

**Claude Code, Codex and Cursor Agent** chats with no working folder, web or data checks make one CLI call with no tool loop. There the same call travels as an optional `selfImprovement` object in the JSON answer, next to `appProposals` and `memories`, and the prompt explains the field. A malformed item becomes a limitation of the answer; the rest of the answer is saved.

## The card

The proposal is stored as an edit to the worker's own instructions (kind `orglet`, action `edit`, hold `self`). The card shows:

- **Learning from feedback · Researcher** as its title.
- **Instructions**: the sentence it replaces struck through, an arrow, the new sentence. An added sentence shows only the new one.
- One line with the feedback as a chip, **Thumbs-down ×2**, then *because of* and the chats it came from, **Q3 summary ×1**, **Plan the launch ×1**, each a link that opens that chat. A chat that was deleted since is plain text.
- **Waiting for you: this changes how this orglet works.** It always waits, even when the worker's **Apply app changes without asking** switch is on; that switch never applies a self-improvement.
- **Apply** and **Dismiss**.

**Apply** saves the worker with the new instructions through the same `saveWorker` command the worker dialog uses, so it is a new revision like any edit, and a run already in progress keeps the instructions it started with. The card then offers **Undo**, which saves the previous instructions again as another revision. Revision history is the audit trail.

**Dismiss** declines that kind of feedback for that worker for good: it is not asked again for that reason. The declined kinds are kept in the core (`selfImprovementDeclined` in settings), not in the window. Applying is not a decline; the count starts over from the applied change.

## Crews

A crew lead does not propose a change to the crew's instructions yet. The crew model has an `instructions` field, so the same card could carry one sentence for it; that is next, once real use shows the lead's synthesis getting the same kind of feedback.

## Out of scope

Fine-tuning, anything that leaves the machine, automatic acceptance, and changing a worker's model, provider, budget or permissions.

## Where it lives

- Contract: `apps/desktop/src/shared/self-improvement.ts` (signal kinds, `ImprovementSignal`, `ProposeSelfImprovement`, the declined-kinds setting); the hold `self` and the `improvement` field in `apps/desktop/src/shared/app-proposals.ts`.
- Detection: `apps/desktop/src/core/orchestration/self-improvement.ts` (`detectImprovementSignals`, `SelfImprovement`).
- Proposal: `apps/desktop/src/core/orchestration/app-proposals.ts` (`draftSelfImprovement`, the hold in `finishRun`, undo kept on apply, decline on dismiss).
- Runner and tools: `apps/desktop/src/core/orchestration/runner.ts` (the frozen snapshot, `selfImprovement` in the brief, the harness field, `ReportRejectedError`), `apps/desktop/src/core/tools/catalog.ts` (`propose_self_improvement`, when it is offered).
- Card: `apps/desktop/src/renderer/components/AppProposals.tsx` (`Because`, the hold line).
- Tests: `tests/integration/self-improvement.test.ts`.
