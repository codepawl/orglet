# Orglets and crews

An **orglet** is one AI worker with a name, a face, instructions and a model. A **crew** is up to eight orglets who take a message together, with one of them as the lead. Both live in the sidebar, and clicking either opens its chat. Older pages call them workers and teams; it is the same thing.

Part of the [user guide](user-guide.md). How a crew turn runs under the hood: [team-chat.md](team-chat.md).

## Orglets

### Create one

1. Click **+** next to **Orglets** in the sidebar.
2. On **General**, give it a name and a short description, write its instructions, and pick its **Model**: a connection (Demo, a local harness, or an API provider) and, for everything but Demo, a model ID from that provider's list or one you type. The **Model** menu lists Demo first, then every connection that can run now (a signed-in harness, an API with a saved key, a custom connection), then the rest greyed under **Unavailable**. A new orglet starts on the first connection that can run now, in that order, and on Demo only when nothing else can. Set its **Limit per task** if you want a cap on what one chat may spend through an API connection. On Claude Code the limit is optional: leave it empty to run on your plan with no cap, or set one to stop Claude Code when its own estimate for a turn reaches it.
3. Choose **Save orglet**. Orglet picks a face and a colour for it from its name and description; the colour can be changed in the same dialog. The new orglet's chat opens, ready for a first message.

The dialog has four tabs:

| Tab | What is there |
|---|---|
| **General** | Name, description, instructions, model, limit per task |
| **Skill** | A reusable set of instructions the orglet works from. Skill packages imported from a folder must be reviewed in the Library before you can pick them. |
| **Permissions** | What the orglet's own chat may do: attached sources, data checks, the web, a working folder, and proposing app changes. See [Permissions](permissions-and-learning.md#permissions). |
| **Memory** | What the orglet remembered from its chats. Edit, pin or delete lines here. See [Memory](memory.md). |

Editing an orglet creates a new revision. A run that is already working keeps the instructions it started with; the change reaches the next turn.

### Talk to one

Click the orglet. Each orglet has one live chat: a new message is a turn, not a new task. Archive the chat (**⋯** next to **Details → Archive**) to start over. Archived chats can delete themselves after a while if you turn that on in **Settings → Chat**.

You can send a changed request while the orglet is still working. Orglet saves it, cancels the older run, waits for it to stop, then sends the new one.

### Archive or delete

Open the row's menu (right-click, or the **⋯** on the row) to edit, archive or delete an orglet. To act on several, click the pencil next to the section title and tick rows, or Ctrl-click (Cmd on macOS) and Shift-click. A bar above the footer then offers **Archive** and **Delete**; delete asks first and names the count.

## Crews

### Create one

1. Click **+** next to **Crews**.
2. Name the crew, write its instructions, and pick **1 to 4 members**. One of them is the **lead** (the dialog calls it the **Orgletrator**): it plans the turn and writes the final answer.
3. Choose the **Workflow**: **In parallel, then combine** (members work at the same time, two at once) or **In sequence, then combine** (each member gets the previous one's result).
4. Under **Limits & shifts**, set **Crew limit / month** and **Limit per task**, **Concurrent tasks** (1–8; above 4 a short note says more at once means more spend at once), and, if you want, **Limit working hours** with a time zone. Outside work hours nothing new starts; a running step finishes and the crew leaves an end-of-shift handoff.
5. Choose **Save crew**. The new crew's chat opens.

**Import template** creates a crew from a template file, with a separate copy of its orglets and shared skills. A saved crew's settings offer **Export saved template**. Templates carry configuration, not keys, sources or chat history. The Research Review and Eris Review templates start on Demo and can bring a required checklist and a dataset check with them; a crew that has one says so under General and can drop it there.

### A crew turn

Click the crew to open its chat. When you send a message:

1. The lead **plans**: it decides which members take this turn and what each one does. It can pause to ask you one short question with two or three choices before it dispatches; pick one, or answer in the message box, and the same run continues.
2. The assigned members **work** as hidden jobs. While they run, the tab above the message box shows their faces and what each one is doing.
3. The lead **combines** their results into one answer in the chat.

Members' own replies and messages to each other stay under **Details**, with cost, retry and cancel for each job. If a member fails, the answer says so and the turn is marked partial; Orglet never invents the missing part. A member that ran into a spending cap leaves the chat **Waiting for budget**, and the message names the limit to raise.

### Tag who should answer

In a crew or group chat, type `@` to pick an orglet, or **Everyone in this chat**. Tagged names highlight. In a crew, the lead is told who you tagged and may still bring in others; in a group chat, only the tagged orglets answer.

## Group chats

A group chat is a few orglets in one conversation without a lead: each one answers in turn, and each can see what the others said.

1. Click the pencil next to **Orglets**, or Ctrl-click rows, and pick two or more orglets.
2. Choose **Group chat** in the bar that appears.
3. The chat opens empty, with the orglets' faces above the message box. Nothing is created until your first message.

A group chat is its own conversation. It does not become any orglet's live chat, and search finds it later. Permissions and a working folder set in **Details** before the first message apply to it the same way as for an orglet or crew.

## Reply to a message

Hover a saved message, yours or an orglet's, and choose **Reply**. The next turn quotes that message so the orglet knows exactly what you mean. **Stop replying to it** in the message box drops the quote. A reply never widens what the orglet may read or change.

Replying to an orglet's answer with a correction also counts as feedback for [self-improvement](self-improvement.md).

## Reactions

Every saved message can take one reaction from you, and one from each orglet:

| | Means |
|---|---|
| 👍 | Agree, keep this direction |
| 🎉 | Exactly what I needed |
| 😂 | That was funny |
| 🤔 | Not sure about this, explain more |
| 👀 | Looking closely at this, be careful |
| 👎 | Not right, try another way |

The react button in a message's action row opens the picker. The reaction sits as a small pill on the message's corner; click a pill to take your reaction off or switch it. A reaction does not start a run and changes no permission. Your reaction on the latest answer is explained to the orglet on its next turn, and a 👎 counts as feedback for [self-improvement](self-improvement.md).

Orglets react too, rarely, when it is natural: to your message, or in a crew or group chat to a colleague's answer. Their pill carries their name. Demo and scheduled runs never react.

Reactions and reply links stay with the chat, survive restart and archive, and travel in a backup.
