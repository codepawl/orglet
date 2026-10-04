# Orglets and channels

An **orglet** is one AI worker with a name, a face, instructions and a model. A **channel** is a named chat of several orglets, like **#launch**. In a channel the orglets either take turns, or a lead splits the work among them and combines it. Channels where the lead splits the work used to be called **crews**; older pages call orglets workers and crews teams. It is the same thing.

Part of the [user guide](user-guide.md). How a channel turn runs under the hood: [team-chat.md](team-chat.md).

## Orglets

### Create one

1. Click **+** next to **Orglets** in the sidebar.
2. On **General**, give it a name and a short description, write its instructions, and pick its **Model**: a connection (Demo, a local harness, or an API provider) and, for everything but Demo, a model ID from that provider's list or one you type. The **Model** menu lists Demo first, then every connection that can run now (a signed-in harness, an API with a saved key, a custom connection), then the rest greyed under **Unavailable**. A new orglet starts on the first connection that can run now, in that order, and on Demo only when nothing else can. Set its **Limit per task** if you want a cap on what one chat may spend through an API connection. On Claude Code the limit is optional: leave it empty to run on your plan with no cap, or set one to stop Claude Code when its own estimate for a turn reaches it.
3. Choose **Save orglet**. Orglet picks a face and a colour for it from its name and description; the colour can be changed in the same dialog. The new orglet's chat opens, ready for a first message.

The dialog has four tabs:

| Tab | What is there |
|---|---|
| **General** | Avatar, name, description, instructions, model, limit per task. The avatar Orglet picks is a face and colour your other orglets do not already show, when one fits, and it stays once saved. |
| **Skill** | A reusable set of instructions the orglet works from. Skill packages imported from a folder must be reviewed in the Library before you can pick them. |
| **Permissions** | What the orglet's own chat may do: attached sources, data checks, the web, a working folder, and proposing app changes. See [Permissions](permissions-and-learning.md#permissions). |
| **Memory** | What the orglet remembered from its chats. Edit, pin or delete lines here. See [Memory](memory.md). |

Editing an orglet creates a new revision. A run that is already working keeps the instructions it started with; the change reaches the next turn.

### Talk to one

Click the orglet. Each orglet has one live chat: a new message is a turn, not a new task. Archive the chat (**⋯** next to **Details → Archive**) to start over. Archived chats are kept in **Settings → Archive**, and can delete themselves after a while if you turn that on there.

Write the way you would to a coworker. A list you end with "…", "etc." or "v.v." is read as the first few of a longer list: the orglet looks for the rest of that kind too. An example ("for example", "ví dụ như") shows what you want, and the orglet makes its own in that style instead of copying it, unless you ask for that exact text.

You can send a changed request while the orglet is still working. Orglet saves it, cancels the older run, waits for it to stop, then sends the new one.

### Archive or delete

Open the row's menu (right-click, or the **⋯** on the row) to edit, archive or delete an orglet. To act on several, click the pencil next to the section title and tick rows, or Ctrl-click (Cmd on macOS) and Shift-click. A bar above the footer then offers **Archive** and **Delete**; delete asks first and names the count.

After you archive something, the toast has **Undo**, and the archived item's line in Notifications has **Open archive**. An orglet that a channel's lead gives work to cannot be archived or deleted: the toast names the channel and has a button that opens its settings, so you can take the orglet out. The same goes for a schedule that still runs it.

Archived things do not sit in the sidebar. They are in **Settings → Archive**, in three groups: orglets, channels (a crew archived before crews became channels is listed here too) and chats (main chats, side threads and schedule runs, each saying whose it was). A group with nothing in it is not shown, and an empty archive says so. When archived items delete themselves after a while (the **Delete archived items** setting at the top of that tab), each row shows the days it has left. **Restore** puts the item back in its sidebar section; **⋯ → Delete permanently** asks first.

## Channels

A channel is a named conversation, like **#launch** or **#research**, with a topic and the orglets you put in it. A one-to-one chat with an orglet, the one you get by clicking it under **Orglets**, is its DM.

### Make one

1. Click **+** next to **Channels**.
2. On **General**, give it a name and, if you like, a topic.
3. On **Members**, tick the orglets that belong in it.
4. On **How it works**, pick how the channel answers a message (see below), then choose **Create channel**.

You can also pick two or more orglets in the sidebar (the pencil next to the section, or Ctrl-click) and choose the **#** button in the bar that appears. The dialog opens with them ticked.

The channel opens empty, with its orglets' faces above the message box, and waits in **Channels** until you write in it. Its header shows **#name** and the topic; **Members** in the chat's menu (⋮) changes who is in it. **Channel settings** in the header's **⋯** or the row's menu changes the name, topic, members and how it works; a change applies from the next message. Rename it in place from the row's menu or by clicking its name in the header. Archive and delete are in the same menus. A channel with no messages yet has nothing to archive, so it can only be deleted.

A channel is its own conversation. It never becomes an orglet's DM, and search finds it by its name. Permissions and a working folder set in **Details** before the first message apply to it the same way as for an orglet.

### How it works

**Take turns.** Each orglet answers in turn and can see what the others said. There is no lead.

**The lead splits the work.** One orglet is the **lead**. When you send a message:

1. The lead **plans**: it decides which orglets take this turn and what each one does. It can pause to ask you one short question with two or three choices before it dispatches; pick one, or answer in the message box, and the same run continues.
2. The assigned orglets **work** as hidden jobs. While they run, the tab above the message box shows their faces and what each one is doing.
3. The lead **combines** their results into one answer in the chat.

Their own replies and messages to each other stay under **Details**, with cost, retry and cancel for each job. If one fails, the answer says so and the turn is marked partial; Orglet never invents the missing part. One that ran into a spending cap leaves the chat **Waiting for budget**, and the message names the limit to raise.

With the lead splitting the work, **How it works** also has:

- **Lead**: one of the channel's orglets. Up to eight orglets do parts of the work.
- **Workflow**: **In parallel, then combine** (they work at the same time, two at once) or **In sequence, then combine** (each gets the previous one's result).
- **Lead's instructions**: how the lead combines the parts.

And a **Limits & shifts** tab: **Channel limit / month**, **Limit per task**, **Concurrent tasks** (1–8; above 4 a short note says more at once means more spend at once), and, if you want, **Limit working hours** with a time zone. Outside work hours nothing new starts; a running step finishes and the channel leaves an end-of-shift handoff.

Switching a channel back to taking turns drops these settings. A schedule that still runs the channel the lead's way has to be turned off first.

### Templates

**Import template** in a new channel's settings creates a channel where the lead splits the work, from a template file, with a separate copy of its orglets and shared skills. A channel where the lead splits the work offers **Export template** on its **General** tab. Templates carry configuration, not keys, sources or chat history. The Research Review and Eris Review templates (the `orglet template` command) start on Demo and can bring a required checklist and a dataset check with them; a channel that has one says so under **How it works** and can drop it there.

### Tag who should answer

In a channel, type `@` to pick an orglet, or **Everyone in this chat**. Tagged names highlight. When the lead splits the work, the lead is told who you tagged and may still bring in others; when orglets take turns, only the tagged orglets answer. Replying to one orglet's answer, without tagging anyone, addresses that orglet alone.

### From crews and group chats

Group chats from before channels became channels when the app updated, with their history: each kept its name, or took its orglets' names when it never had one.

Crews became channels where the lead splits the work, with the same name, orglets, lead, workflow, budget, hours, schedules and chat history. A crew you had archived comes back as a channel when you restore it from **Archived channels**. A channel that had a crew among its members now has that crew's orglets.

If you downloaded Tacet in **Settings → Chat**, a message that tags nobody and replies to no one can go to just the orglet it clearly fits, going by each orglet's name, description and instructions. Your message then says **Tacet picked *name* to answer**. When Tacet is not sure, everyone answers, as without it. Tag `@all` to ask everyone anyway. See [how Tacet decides](decisions.md#who-answers-in-a-group-chat).

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

Orglets react too, rarely, when it is natural: to your message, or in a channel to a colleague's answer. Their pill carries their name. Demo and scheduled runs never react.

Reactions and reply links stay with the chat, survive restart and archive, and travel in a backup.
