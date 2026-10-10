import { t } from './text';
import { COMPLETION_SHELLS, type CompletionShell } from './completion';
import { ChatId, DEFAULT_WAIT_SECONDS, MAX_FILES, MAX_READ_TURNS, MAX_WAIT_SECONDS, MessageRef, UserMessageRef, TEMPLATE_IDS, type ChatChange, type ChatControl, type CliRequestBody } from './protocol';
import { ClockTime, EVERY_HOURS_CHOICES, MAX_DAILY_CAP_MICROS } from '../shared/schedule';
import { MEMORY_TEXT_LIMIT } from '../shared/knowledge';
import { ProviderId } from '../shared/contracts';
import { MAX_FORWARD_TARGETS } from '../shared/forward';
import { Reaction } from '../shared/message-interactions';

/** Turning `orglet …` arguments into one command, and the help text for each (COD-234). */

export type CommandName = 'chat' | 'status' | 'list' | 'send' | 'read' | 'open' | 'run' | 'config' | 'create' | 'edit' | 'delete'
  | 'react' | 'forward' | 'answer' | 'revise' | ChatControl
  | 'chats' | 'side' | 'bring' | 'channel' | 'group' | 'members' | 'rename' | 'archive' | 'restore' | 'template'
  | 'schedules' | 'schedule' | 'spaces' | 'space' | 'market' | 'completion'
  | 'search' | 'running' | 'library' | 'memory' | 'usage' | 'models' | 'preferences';
/** The fields `orglet schedule add` and `edit` may set (COD-354), as the protocol carries them. */
export type ScheduleFields = Omit<Extract<CliRequestBody, { op: 'schedule-save' }>, 'op' | 'schedule'>;
export type ManagementCommand = { entity: 'worker' | 'team'; name?: string; config?: string; confirm?: string; json: boolean } & ({ kind: 'create' } | { kind: 'edit' } | { kind: 'delete' });
/** A chat named by its orglet or crew, or by the start of its id as `orglet chats` prints it (COD-354). */
export type ChatTarget = { to: string } | { chat: string };
type TemplateId = typeof TEMPLATE_IDS[number];

export type ParsedCommand =
  | { kind: 'help'; topic?: CommandName }
  | { kind: 'version' }
  | ManagementCommand
  | { kind: 'config'; json: boolean }
  | { kind: 'chat'; to?: string }
  | { kind: 'status'; json: boolean }
  | { kind: 'list'; json: boolean }
  | ({ kind: 'send'; message: string; files: string[]; wait: boolean; timeoutSeconds: number; json: boolean; replyTo?: string } & ChatTarget)
  | ({ kind: 'read'; json: boolean; turns?: number } & ChatTarget)
  | ({ kind: 'react'; emoji: Reaction; active: boolean; message?: string; json: boolean } & ChatTarget)
  | ({ kind: 'forward'; targets: string[]; message?: string; note?: string; json: boolean } & ChatTarget)
  | ({ kind: 'control'; action: ChatControl; wait: boolean; timeoutSeconds: number; json: boolean } & ChatTarget)
  | ({ kind: 'revise'; text: string; message: string; files?: string[]; wait: boolean; timeoutSeconds: number; json: boolean } & ChatTarget)
  | ({ kind: 'answer'; answer: string; wait: boolean; timeoutSeconds: number; json: boolean } & ChatTarget)
  | { kind: 'chats'; archived: boolean; space?: string; json: boolean }
  | ({ kind: 'side'; message: string; files?: string[]; wait: boolean; timeoutSeconds: number; json: boolean } & ChatTarget)
  | { kind: 'bring'; chat: string; message?: string; json: boolean }
  | { kind: 'channel'; names: string[]; message?: string; files?: string[]; name?: string; topic?: string; space?: string; category?: string; wait: boolean; timeoutSeconds: number; json: boolean }
  | { kind: 'members'; chat: string; names: string[]; json: boolean }
  | ({ kind: 'chat-change'; change: ChatChange; title?: string; confirmName?: string; json: boolean } & ChatTarget)
  | { kind: 'archive-entity'; entity: 'worker' | 'team'; name: string; archived: boolean; json: boolean }
  | { kind: 'template'; templateId: TemplateId; provider: 'demo' | 'openai'; json: boolean }
  | { kind: 'schedules'; json: boolean }
  | { kind: 'spaces'; json: boolean }
  | { kind: 'market'; verb: 'list' | 'installed' | 'add'; listingId?: string; refresh: boolean; json: boolean }
  | { kind: 'space'; verb: 'add' | 'edit' | 'category' | 'uncategory' | 'move' | 'out' | 'delete'; space?: string; names: string[]; rename?: string; category?: string; chat?: string; channelName?: string; confirmName?: string; json: boolean }
  | { kind: 'completion'; shell: CompletionShell }
  | { kind: 'schedule-enable'; schedule: string; enabled: boolean; json: boolean }
  | { kind: 'schedule-delete'; schedule: string; confirmName: string; json: boolean }
  | { kind: 'schedule-save'; schedule?: string; fields: ScheduleFields; json: boolean }
  | { kind: 'search'; query: string; space?: string; json: boolean }
  | { kind: 'running'; space?: string; json: boolean }
  | { kind: 'library'; library: 'memory' | 'note'; query?: string; owner?: string; json: boolean }
  | { kind: 'memory-edit'; id: string; text?: string; pinned?: boolean; json: boolean }
  | { kind: 'memory-delete'; id: string; confirm?: string; json: boolean }
  | { kind: 'usage'; refresh: boolean; json: boolean }
  | { kind: 'models'; provider?: ProviderId; to?: string; refresh: boolean; json: boolean }
  | { kind: 'preferences'; language?: 'vi' | 'en' | 'en-GB'; theme?: 'system' | 'light' | 'dark'; json: boolean }
  | { kind: 'open'; to?: string; json: boolean }
  | { kind: 'run'; schedule: string; files: string[]; json: boolean };

/** A mistake in how the command was typed; exits with code 2. */
export class UsageError extends Error {}

const CONTROL_COMMANDS: readonly ChatControl[] = ['stop', 'pause', 'resume', 'retry', 'continue'];
export const COMMAND_NAMES: readonly CommandName[] = ['chat', 'status', 'list', 'send', 'read', 'open', 'run', 'config', 'create', 'edit', 'delete',
  'react', 'forward', 'answer', 'revise', ...CONTROL_COMMANDS, 'chats', 'side', 'bring', 'channel', 'group', 'members', 'rename', 'archive', 'restore', 'template',
  'schedules', 'schedule', 'spaces', 'space', 'market', 'completion', 'search', 'running', 'library', 'memory', 'usage', 'models', 'preferences'];
/** Commands that name an orglet or crew with --to; `schedule` names the one it runs for, `library` and `models` whose. */
const CHAT_COMMANDS: readonly CommandName[] = ['chat', 'send', 'read', 'open', 'react', 'forward', 'answer', 'revise', ...CONTROL_COMMANDS, 'side', 'rename', 'archive', 'schedule', 'library', 'models'];
/** Commands that name a chat with --chat, by the start of its id. */
const CHAT_ID_COMMANDS: readonly CommandName[] = ['send', 'read', 'react', 'forward', 'answer', 'revise', ...CONTROL_COMMANDS, 'side', 'bring', 'members', 'rename', 'archive', 'restore', 'delete'];
/**
 * Commands whose message takes files with --file. `answer` is not one: the core's answer command has no field for
 * sources, so there is nowhere to put a file.
 */
const FILE_COMMANDS: readonly CommandName[] = ['send', 'run', 'side', 'channel', 'group', 'revise'];
/** Commands that start a turn and wait for it, so --no-wait and --timeout apply. */
const WAITING_COMMANDS: readonly CommandName[] = ['send', 'answer', 'revise', 'resume', 'retry', 'continue', 'side', 'channel', 'group'];

export const MAIN_HELP = `orglet: talk to the Orglet app from a terminal.

The app must be installed; it is started if it is not running. Keys, chats and
files stay in the app. This command only sends requests to it.

Usage:
  orglet                     Chat in this terminal: pick an orglet or channel
  orglet <command> [options]

Commands:
  chat      Talk to an orglet or channel in this terminal
  status    Whether the app is running, its version, how many orglets and channels
  list      Orglets and channels by name, with their provider and model
  send      Send a message to an orglet or channel and print the answer
  read      Print the latest answer in a chat, or its past turns with --turns
  react     React to a message in a chat
  forward   Forward a message to other orglets or channels
  revise    Correct a saved message and start a new turn
  answer    Answer the question an orglet is waiting on
  stop      Stop the turn that is running in a chat
  pause     Pause the running turn after its current step
  resume    Resume a paused or interrupted turn
  retry     Run the latest message again
  continue  Continue an answer that ran out of steps
  chats     List chats, side threads and channels with their ids
  side      Start a side thread from an orglet's chat
  bring     Bring a side thread's answer into its main chat
  channel   Start a channel of orglets with its first message
  group     The older name of channel
  members   Change who is in a channel
  rename    Rename a chat
  archive   Archive a chat, an orglet or a channel
  restore   Restore an archived chat, orglet or channel
  template  Create a channel from one of the app's templates
  schedules List schedules with their timing and limits
  schedule  Create, edit, switch on or off, or delete a schedule
  spaces    List spaces with their orglets and channels
  space     Create, change or delete a space, or move a channel into one
  market    The marketplace: its listings, what you added, and adding one
  completion  Print the completion script for PowerShell, bash or zsh
  search    Search every chat, message and name
  running   Every run working or waiting across chats
  library   Memories or notes, optionally of one orglet or channel
  memory    Edit, pin or delete an approved memory
  usage     Plan usage of signed-in CLI accounts
  models    The models a connection offers
  preferences  Show or change the app's language and theme
  open      Bring the Orglet window forward, optionally on one chat
  run       Start a schedule now, optionally with files
  config    Show editable configurations, skill IDs and existing connections
  create    Create an orglet or channel from a JSON configuration
  edit      Apply a JSON patch to an orglet or channel
  delete    Remove an orglet or channel, or a chat, with an exact-name confirmation

Commands that name a chat with --to also take --chat <id>, the start of a chat's
id as "orglet chats" prints it, for side threads, channels and older chats.

A channel with a lead who splits the work was once called a crew. The older names
still work as input: crew and team for channel in create, edit, delete, archive
and restore, and group for the channel command.

Options:
  -h, --help       Show help. "orglet <command> --help" shows a command's options.
  -v, --version    Show the version of this command

Exit codes: 0 ok, 1 failure, 2 usage error, 3 app not reachable.`;

/** The help of `orglet channel` and of `orglet group`, its older name (COD-361). */
function channelHelp(command: 'channel' | 'group'): string {
  return t("Cách dùng: orglet {0} \"<tin nhắn>\" --with <tên> [--with <tên>] [tùy chọn]\n\nTạo một kênh với các Tí này và gửi tin nhắn đầu tiên, như tạo kênh\ntrong app. Mỗi Tí trả lời lần lượt. Nhắn\ntiếp bằng orglet send --chat <mã>. orglet group là tên cũ của lệnh này.\nVới --space, kênh nằm trong không gian đó; bỏ --with thì kênh nhận mọi Tí\ncủa không gian hoặc của mục. Bỏ tin nhắn và đặt --name thì chỉ tạo kênh.\nKhông có --space, kênh vào không gian dành cho các kênh, tên là Kênh.\n\nTùy chọn:\n  --with <tên>         Một Tí hoặc kênh; lặp lại cho nhiều thành viên\n  --name <tên>         Tên kênh; mặc định là tên các thành viên\n  --topic <chủ đề>     Chủ đề của kênh\n  --space <tên>        Không gian chứa kênh\n  --category <tên>     Mục của không gian đó chứa kênh\n  --file <đường dẫn>   Đính một tệp vào tin nhắn đầu tiên; lặp lại cho nhiều tệp\n  --no-wait            Trả về ngay sau khi gửi\n  --timeout <giây>     Thời gian chờ câu trả lời (mặc định {1})\n  --json               In JSON cho máy đọc", command, DEFAULT_WAIT_SECONDS);
}

/** What `<orglet|channel>` also accepts, said in the help of every command that takes it. */
function withEntityAliases(help: string): string {
  return `${help}\n\n${t("crew và team vẫn dùng được thay cho channel (tên cũ).")}`;
}

export const COMMAND_HELP: Record<CommandName, string> = {
  config: t("Cách dùng: orglet config [--json]\n\nHiện cấu hình có thể sửa, ID, phiên bản, skill và tên kết nối.\nKhông bao gồm khóa hay quyền truy cập."),
  create: withEntityAliases(t("Cách dùng: orglet create <orglet|channel> --config <file.json> [--json]\n\nTạo Tí hoặc kênh. Dùng \"orglet config --json\" để xem ID skill và thành viên.\nTrong TUI, /new mở form bằng bàn phím.\nTí cần name, instructions, provider và skillId.\nKênh cần name và members, một danh sách {\"kind\":\"orglet\",\"id\":\"<ID>\"}. topic và mode (turns hoặc lead) là tùy chọn. Khi lead chia việc, lead là cài đặt của nó: synthesizerId, instructions, workflow, monthlyBudgetMicros, maxConcurrentTasks và taskBudgetMicros.\nTên cũ memberIds và các trường của lead đặt ngoài lead vẫn dùng được.\nGiới hạn là số nguyên phần triệu USD.")),
  edit: withEntityAliases(t("Cách dùng: orglet edit <orglet|channel> \"<tên>\" --config <patch.json> [--json]\n\nChỉ thay đổi trường được cung cấp; giữ nguyên trường bị bỏ qua.\nnull xóa giá trị tùy chọn của Tí; topic rỗng xóa chủ đề của kênh. Từ chối cấu hình vừa bị thay đổi ở nơi khác.\nKênh lần lượt trả lời chỉ nhận cài đặt lead khi có \"mode\": \"lead\".\nTrong TUI, /edit mở thiết lập của chat đang chọn.")),
  delete: withEntityAliases(`${t("Cách dùng: orglet delete <orglet|channel> \"<tên>\" --confirm \"<tên đầy đủ>\" [--json]\n\nCần tên đầy đủ khớp hoàn toàn. Chat cũ vẫn đọc được.\nKênh, lịch đang bật và việc đang chạy có thể ngăn xóa. Xóa Tí cuối cùng thì danh sách để trống.\nKênh lần lượt trả lời đã có tin nhắn thì xóa như một chat (bên dưới).\nTrong TUI, /delete yêu cầu gõ tên.")}\n\n${t("Xóa một chat: orglet delete --chat <mã> --confirm \"<tên chat>\" [--json]\nCần tên chat khớp hoàn toàn, như orglet chats in ra. Không thể hoàn tác.")}`),
  chat: `Usage: orglet chat [--to <name>]

Opens a chat in this terminal. Pick an orglet or channel with the arrow keys or by
typing part of its name, then write messages; each answer prints as it lands.
Running orglet with no command in a terminal does the same.

In the chat, /to <name> switches chat, /list lists orglets and channels, /read
shows the latest answer again, /open brings the app to this chat, /clear
clears the screen, /queue shows pending messages and commands, /undo takes the
last queued item back into the draft, /help lists these and /exit leaves.
/new [orglet|channel], /edit [name] and /delete [name] manage configurations here.
/history, /revise, /reply, /react, /forward, /answer, /stop, /pause, /resume, /retry and
/continue act on this chat; /chats, /side, /bring, /channel, /members, /rename
and /archive handle the chats themselves, and /to #id opens one by its id.
/help describes each.
/open, /clear, /queue, /undo and /help work while waiting. Press Ctrl+C twice
to leave; typing or Esc dismisses the first hint. Sent work keeps running.

The header shows the connection and selected model. Chat requires a real
connection; /open configures it in the app, then /list refreshes the picker.
Ctrl+O expands answer details and Ctrl+G shows agents. Ctrl+Q shows the queue,
Ctrl+Z edits its last item; Ctrl+P or Left on an empty draft picks another chat.
Page Up/Down scrolls. Ctrl+J adds a line; Ctrl+D leaves.

Options:
  --to <name>    Open this chat straight away`,
  status: `Usage: orglet status [--json]

Shows whether the app is reachable, its version, and how many orglets and channels
it has.

Options:
  --json    Print machine-readable JSON`,
  list: `Usage: orglet list [--json]

Lists orglets and channels by name, with each orglet's provider and model and each
channel's lead and members.

Options:
  --json    Print machine-readable JSON`,
  send: `Usage: orglet send "<message>" --to <name> [options]

Sends a message into the chat with an orglet or channel, the same way the app's
message box does, and prints the answer. A channel prints each orglet's reply
with its name. The name matches case-insensitively; a unique start of a name
is enough.

Options:
  --to <name>          The orglet or channel (required)
  --file <path>        Attach a file; repeat for more (up to ${MAX_FILES})
  --reply-to <number>  Reply to a message, numbered as "orglet read --turns" prints it
  --no-wait            Return right after sending
  --timeout <seconds>  How long to wait for the answer (default ${DEFAULT_WAIT_SECONDS})
  --json               Print machine-readable JSON

Example:
  orglet send "Summarise this file" --to Researcher --file notes.txt`,
  read: t("Cách dùng: orglet read --to <tên> [--turns <số>] [--json]\n\nIn câu trả lời mới nhất trong chat với Tí hoặc kênh.\nVới --turns, in các lượt gần nhất, mỗi tin nhắn có số: #3 là tin thứ ba\ncủa bạn, #3.1 là câu trả lời đầu tiên cho tin đó. Dùng số này với\nreact, forward và send --reply-to.\n\nTùy chọn:\n  --to <tên>       Tí hoặc kênh (bắt buộc)\n  --turns <số>     In bấy nhiêu lượt gần nhất, từ 1 đến {0}\n  --json           In JSON cho máy đọc", MAX_READ_TURNS),
  react: t("Cách dùng: orglet react <cảm xúc> --to <tên> [--message <số>] [--off] [--json]\n\nThả cảm xúc lên một tin nhắn, như nút cảm xúc trong app. Mỗi tin có một cảm\nxúc của bạn; cảm xúc mới thay cái cũ. Tí đọc cảm xúc ở lượt sau.\nCảm xúc: {0}.\n\nTùy chọn:\n  --to <tên>         Tí hoặc kênh (bắt buộc)\n  --message <số>     Tin nhắn theo số của read --turns, như 3 hoặc 3.1;\n                     mặc định là câu trả lời mới nhất\n  --off              Gỡ cảm xúc này\n  --json             In JSON cho máy đọc", Reaction.options.join(', ')),
  forward: t("Cách dùng: orglet forward --to <tên> --target <tên> [--target <tên>] [tùy chọn]\n\nChuyển tiếp một tin nhắn sang chat của Tí hoặc kênh khác, như tin của chính\nbạn, tối đa {0} nơi. Mỗi nơi nhận nó như một lượt mới và trả lời. Tệp chỉ\nđi kèm tên; đính tệp thật trong app.\n\nTùy chọn:\n  --to <tên>         Chat có tin nhắn (bắt buộc)\n  --target <tên>     Nơi nhận; lặp lại để gửi nhiều nơi\n  --message <số>     Tin nhắn theo số của read --turns; mặc định là câu trả\n                     lời mới nhất\n  --note <chữ>       Lời nhắn kèm theo\n  --json             In JSON cho máy đọc", MAX_FORWARD_TARGETS),
  answer: t("Cách dùng: orglet answer \"<câu trả lời>\" --to <tên> [--no-wait] [--timeout <giây>] [--json]\n\nTrả lời câu hỏi Tí đang chờ, rồi đợi lượt chạy tiếp như send. Gõ số của một\nlựa chọn (1, 2, 3) hoặc câu của bạn. read và send in câu hỏi cùng các lựa\nchọn. Câu hỏi xin quyền dùng công cụ MCP chỉ trả lời được trong app.\n\nTùy chọn:\n  --to <tên>           Tí hoặc kênh (bắt buộc)\n  --no-wait            Trả về ngay sau khi trả lời\n  --timeout <giây>     Thời gian chờ câu trả lời (mặc định {0})\n  --json               In JSON cho máy đọc", DEFAULT_WAIT_SECONDS),
  revise: t('Cách dùng: orglet revise "<chữ đã sửa>" --to <tên> --message <số> [--file <đường dẫn>] [--no-wait] [--timeout <giây>] [--json]\n\nSửa tin nhắn của bạn và chạy một lượt mới với tệp gốc còn được phép dùng.\nLịch sử cũ giữ nguyên. Chờ lượt đang chạy dừng trước khi sửa. Dùng --chat <mã> để chọn chat theo mã.\nVới --file, các tệp đó được đính thêm vào lượt mới, cạnh tệp gốc.'),
  ...controlHelp(),
  chats: t("Cách dùng: orglet chats [--archived] [--space <tên>] [--json]\n\nLiệt kê chat, mới nhất trước: chat chính của Tí và kênh, chat phụ, kênh và lần\nchạy của lịch, mỗi chat có mã ngắn. Dùng mã với --chat trong các lệnh khác.\n\nTùy chọn:\n  --archived     Chỉ liệt kê chat đã lưu trữ\n  --space <tên>  Chỉ liệt kê kênh của không gian này\n  --json         In JSON cho máy đọc"),
  side: t("Cách dùng: orglet side \"<tin nhắn>\" --to <tên Tí> [--file <đường dẫn>] [--no-wait] [--timeout <giây>] [--json]\n\nGửi tin trong một chat phụ mới của Tí, như \"Gửi trong luồng mới\" trong app.\nChat phụ mang quyền, thư mục và MCP của chat chính, không bao giờ rộng hơn.\nChat chính giữ nguyên. Lệnh in mã của chat phụ để nhắn tiếp bằng --chat.\n\nTùy chọn:\n  --to <tên>           Tí có chat chính (hoặc --chat <mã> của chat đó)\n  --file <đường dẫn>   Đính một tệp vào tin này; lặp lại cho nhiều tệp\n  --no-wait            Trả về ngay sau khi gửi\n  --timeout <giây>     Thời gian chờ câu trả lời (mặc định {0})\n  --json               In JSON cho máy đọc", DEFAULT_WAIT_SECONDS),
  bring: t("Cách dùng: orglet bring --chat <mã chat phụ> [--message <số>] [--json]\n\nĐưa một câu trả lời của chat phụ vào chat chính dưới dạng trích dẫn. Không\nchạy lượt mới nào. Mặc định là câu trả lời mới nhất.\n\nTùy chọn:\n  --chat <mã>        Chat phụ (bắt buộc)\n  --message <số>     Câu trả lời theo số của read --turns, như 2.1\n  --json             In JSON cho máy đọc"),
  channel: channelHelp('channel'),
  group: channelHelp('group'),
  members: t("Cách dùng: orglet members --chat <mã> --with <tên> [--with <tên>] [--json]\n\nĐổi thành viên của một kênh, từ tin nhắn sau. Thay cả danh sách. Thành viên là\nTí hoặc kênh; một kênh trả lời bằng các Tí của nó.\n\nTùy chọn:\n  --chat <mã>      Kênh (bắt buộc)\n  --with <tên>     Một Tí hoặc kênh; lặp lại cho nhiều thành viên\n  --json           In JSON cho máy đọc"),
  rename: t("Cách dùng: orglet rename --to <tên> | --chat <mã> --rename \"<tên mới>\" [--json]\n\nĐổi tên hiển thị của một chat. Tên Tí hoặc kênh không đổi.\n\nTùy chọn:\n  --to <tên>         Chat chính của Tí hoặc kênh\n  --chat <mã>        Chat theo mã của orglet chats\n  --rename <tên>     Tên mới (bắt buộc)\n  --title <tên>      Tên cũ của --rename\n  --json             In JSON cho máy đọc"),
  archive: withEntityAliases(t("Cách dùng: orglet archive --to <tên> | --chat <mã> [--json]\n       orglet archive <orglet|channel> \"<tên đầy đủ>\" [--json]\n\nLưu trữ một chat, hoặc một Tí hay kênh. Chat đã lưu trữ không nhận tin mới cho\nđến khi khôi phục. Tí hay kênh đang dùng ở nơi khác, hoặc đang chạy, không lưu\ntrữ được; lỗi sẽ nói lý do.\n\nTùy chọn:\n  --to <tên>       Chat chính của Tí hoặc kênh\n  --chat <mã>      Chat theo mã của orglet chats\n  --json           In JSON cho máy đọc")),
  restore: withEntityAliases(t("Cách dùng: orglet restore --chat <mã> [--json]\n       orglet restore <orglet|channel> \"<tên đầy đủ>\" [--json]\n\nKhôi phục một chat, Tí hay kênh đã lưu trữ. orglet chats --archived liệt kê\nchat đã lưu trữ cùng mã của chúng.\n\nTùy chọn:\n  --chat <mã>      Chat đã lưu trữ\n  --json           In JSON cho máy đọc")),
  spaces: t("Cách dùng: orglet spaces [--json]\n\nLiệt kê không gian: Tí trong đó, rồi từng kênh với nhóm của nó và những Tí ở trong kênh."),
  space: t("Cách dùng: orglet space add \"<tên>\" --with <Tí> [--with <Tí>]\n       orglet space edit \"<tên>\" [--rename <tên mới>] [--with <Tí> ...]\n       orglet space category \"<tên>\" --category <tên mục> [--rename <tên mới>] [--with <Tí> ...]\n       orglet space uncategory \"<tên>\" --category <tên mục>\n       orglet space move \"<tên>\" (--chat <mã> | --name <tên kênh>) [--category <tên mục>]\n       orglet space out (--chat <mã> | --name <tên kênh>)\n       orglet space delete \"<tên>\" --confirm \"<tên đầy đủ>\"\n\nTạo và sửa không gian như trong app. edit với --with thay toàn bộ danh sách Tí\ncủa không gian. category thêm một mục, hoặc đổi tên mục đã có và đặt các Tí riêng\ncủa nó; uncategory xóa mục và giữ các kênh trong không gian. move đưa một kênh vào\nkhông gian hoặc một mục của nó, out đưa kênh ra ngoài mọi không gian. Kênh chưa có\ntin nhắn thì chỉ bằng --name. Xóa không gian thì các kênh của nó vẫn còn.\nLệnh này không đặt quyền hay thư mục.\n\nTùy chọn:\n  --with <Tí>          Một Tí của không gian; lặp lại cho nhiều Tí\n  --rename <tên>       Tên mới của không gian\n  --category <tên>     Mục cần thêm, hoặc mục nhận kênh\n  --chat <mã>          Mã của kênh, như orglet chats in ra\n  --name <tên kênh>    Tên của kênh, thay cho --chat\n  --confirm <tên>      Tên đầy đủ của không gian cần xóa\n  --json               In JSON cho máy đọc"),
  completion: t("Cách dùng: orglet completion <powershell|bash|zsh>\n\nIn đoạn mã tự hoàn thành cho shell đó: tên lệnh trước, rồi tên tùy chọn. Đoạn mã\nkhông hỏi app và không chứa tên Tí, chat hay không gian nào.\n\n  PowerShell   orglet completion powershell | Out-String | Invoke-Expression\n  bash         eval \"$(orglet completion bash)\"\n  zsh          eval \"$(orglet completion zsh)\"\n\nĐặt dòng đó vào tệp khởi động của shell để dùng mỗi lần mở."),
  market: t("Cách dùng: orglet market [--refresh] [--json]\n       orglet market installed [--json]\n       orglet market add <mã> [--json]\n\nLiệt kê marketplace: mã, loại, tên, tác giả và mô tả của từng mục. installed liệt kê\nnhững gì đã thêm từ marketplace và mục nào có bản cập nhật. add thêm bản hiện tại\ncủa một mục: các Tí của nó, cùng kênh hoặc không gian nó mang theo. Không cần tài khoản.\nXuất bản, duyệt và áp dụng bản cập nhật làm trong app, nơi bạn xem nội dung trước.\n\nTùy chọn:\n  --refresh      Tải lại danh mục thay vì dùng bản đã lưu\n  --json         In JSON cho máy đọc"),
  schedules: t("Cách dùng: orglet schedules [--json]\n\nLiệt kê lịch: bật hay tắt, Tí hoặc kênh chạy nó, khi nào chạy, lần tới, giới hạn mỗi\nlần và mỗi ngày. Số tiền trong --json là số nguyên phần triệu USD."),
  schedule: t("Cách dùng: orglet schedule add \"<tên>\" --to <tên> --brief \"<việc>\" --every <khi> --at <HH:MM> --budget <USD> [tùy chọn]\n       orglet schedule edit \"<tên>\" [tùy chọn]\n       orglet schedule on|off \"<tên>\"\n       orglet schedule delete \"<tên>\" --confirm \"<tên>\"\n\nTạo, sửa, bật, tắt hoặc xóa một lịch. Lịch tạo ở đây không có quyền công cụ,\ntrình duyệt hay thư mục; các provider của Tí hoặc kênh phải được cho phép sẵn\ntrong Cài đặt của app. Chọn những thứ đó trong app. Chạy ngay: orglet run.\n\nTùy chọn:\n  --to <tên>            Tí hoặc kênh chạy lịch\n  --brief <việc>        Brief gửi mỗi lần chạy\n  --every <khi>         daily, weekdays, weekly, hoặc số giờ như 2h\n  --at <HH:MM>          Giờ chạy; với số giờ là giờ đầu tiên trong ngày\n  --day <ngày>          Ngày trong tuần cho weekly: mon, tue, …, sun\n  --timezone <vùng>     Múi giờ, như Asia/Ho_Chi_Minh; mặc định là của máy\n  --budget <USD>        Giới hạn mỗi lần chạy\n  --daily-cap <USD>     Giới hạn mỗi ngày (không bắt buộc)\n  --called              Chỉ chạy khi gọi bằng orglet run\n  --off                 Tạo lịch ở trạng thái tắt (add)\n  --rename <tên>        Tên mới (edit)\n  --json                In JSON cho máy đọc"),
  search: t("Cách dùng: orglet search \"<từ cần tìm>\" [--json]\n\nTìm trong mọi tin nhắn, câu trả lời, tên chat, Tí và kênh, như ô tìm kiếm của app.\nKhông phân biệt hoa thường hay dấu. In mã chat để đọc bằng orglet read --chat.\n\nTùy chọn:\n  --json     In JSON cho máy đọc"),
  running: t("Cách dùng: orglet running [--json]\n\nMọi lượt đang chạy, đang chờ đến lượt hoặc dừng ở checkpoint, trên mọi chat,\nnhư mục Đang chạy của app, kèm điều mỗi lượt đang chờ.\n\nTùy chọn:\n  --json     In JSON cho máy đọc"),
  library: t("Cách dùng: orglet library [memory|notes] [--to <tên>] [--query <từ>] [--json]\n\nGhi nhớ (mặc định) hoặc ghi chú trong Thư viện, kể cả mục đang chờ duyệt.\nDuyệt hay bỏ mục đang chờ trong app.\n\nTùy chọn:\n  --to <tên>       Chỉ của Tí hoặc kênh này\n  --query <từ>     Tìm như ô tìm kiếm của Thư viện\n  --json           In JSON cho máy đọc"),
  memory: t("Cách dùng: orglet memory edit <mã> [--text \"<nội dung>\"] [--pin|--unpin] [--json]\n       orglet memory delete <mã> --confirm \"<mã hoặc nội dung>\" [--json]\n\nSửa, ghim hoặc xóa một ghi nhớ đã duyệt, như tab Ghi nhớ của Tí. Sửa tạo bản\nmới; xóa là vĩnh viễn. Ghi nhớ đang chờ duyệt chỉ duyệt được trong app.\n\nTùy chọn:\n  --text <nội dung>  Nội dung mới, tối đa {0} ký tự\n  --pin, --unpin     Ghim hoặc bỏ ghim\n  --confirm <chữ>    Xác nhận xóa: gõ mã của ghi nhớ hoặc đúng nội dung của nó\n  --yes              Tên cũ của việc xác nhận xóa, khi không gõ gì\n  --json             In JSON cho máy đọc", MEMORY_TEXT_LIMIT),
  usage: t("Cách dùng: orglet usage [--refresh] [--json]\n\nMức dùng gói của các tài khoản CLI đã đăng nhập (Claude Code, Codex, Cursor\nAgent, Gemini CLI), như Cài đặt. Email chỉ hiện một phần.\n\nTùy chọn:\n  --refresh    Đọc lại ngay thay vì dùng số vừa đọc\n  --json       In JSON cho máy đọc"),
  models: t("Cách dùng: orglet models <provider> | --to <tên Tí> [--refresh] [--json]\n\nCác model một kết nối cung cấp, như danh sách model khi sửa Tí.\n\nTùy chọn:\n  --to <tên>     Dùng kết nối của Tí này\n  --refresh      Tải lại danh sách\n  --json         In JSON cho máy đọc"),
  preferences: t("Cách dùng: orglet preferences [--language vi|en|en-GB] [--theme system|light|dark] [--json]\n\nHiện hoặc đổi ngôn ngữ và giao diện của app. Các cài đặt khác ở trong app.\n\nTùy chọn:\n  --language <mã>    Ngôn ngữ của app\n  --theme <kiểu>     Giao diện sáng, tối hoặc theo hệ thống\n  --json             In JSON cho máy đọc"),
  template: t("Cách dùng: orglet template <{0}> --provider openai [--json]\n\nTạo một kênh từ mẫu của app, kèm các Tí và skill của nó. --provider chọn kết\nnối cho các Tí mới: openai là kết nối OpenAI đã thiết lập trong app. Chọn\nmodel cho từng Tí trong app nếu cần.\n\nTùy chọn:\n  --provider <tên>   openai (bắt buộc)\n  --json             In JSON cho máy đọc", TEMPLATE_IDS.join('|')),
  open: `Usage: orglet open [--to <name>]

Brings the Orglet window forward. With --to, opens that chat.

Options:
  --to <name>    The orglet or channel to open
  --json         Print machine-readable JSON`,
  run: `Usage: orglet run "<schedule>" [--file <path>] [--json]

Starts a schedule from the app's Schedules now, with its brief, its orglet or
channel and its limit, and returns once the run has started. The name matches
case-insensitively; a unique start of a name is enough. Files given with
--file are attached to this run, next to the schedule's own sources.

The schedule must exist, be switched on and be saved as it is now. This
command cannot create or change one; "orglet schedule" does. Any schedule can be started this way,
and one set to "Only when called" runs only like this. Nothing runs while
the app is closed; the command starts the app first.

Options:
  --file <path>  Attach a file to this run; repeat for more (up to ${MAX_FILES})
  --json         Print machine-readable JSON

Example:
  orglet run "Invoice check" --file invoice.pdf`,
};

/** One help text for the five controls of a chat's latest turn; they take the same options. */
function controlHelp(): Record<ChatControl, string> {
  const text = t("Cách dùng: orglet <stop|pause|resume|retry|continue> --to <tên> [--no-wait] [--timeout <giây>] [--json]\n\nCác nút dưới lượt mới nhất của chat, như trong app:\n  stop       Dừng lượt đang chạy\n  pause      Tạm dừng sau bước đang làm\n  resume     Tiếp tục lượt đã tạm dừng hoặc bị ngắt từ checkpoint\n  retry      Chạy lại tin nhắn mới nhất với thiết lập hiện tại\n  continue   Tiếp tục câu trả lời bị dừng vì hết bước\n\nresume, retry và continue đợi câu trả lời như send.\n\nTùy chọn:\n  --to <tên>           Tí hoặc kênh (bắt buộc)\n  --no-wait            Trả về ngay, không đợi câu trả lời\n  --timeout <giây>     Thời gian chờ (mặc định {0})\n  --json               In JSON cho máy đọc", DEFAULT_WAIT_SECONDS);
  return { stop: text, pause: text, resume: text, retry: text, continue: text };
}

type Options = {
  help: boolean;
  version: boolean;
  json: boolean;
  wait: boolean;
  off: boolean;
  archived: boolean;
  called: boolean;
  pin: boolean;
  unpin: boolean;
  yes: boolean;
  refresh: boolean;
  query?: string;
  text?: string;
  language?: string;
  theme?: string;
  to?: string;
  brief?: string;
  every?: string;
  at?: string;
  day?: string;
  timezone?: string;
  budget?: string;
  dailyCap?: string;
  rename?: string;
  chat?: string;
  timeout?: string;
  config?: string;
  confirm?: string;
  turns?: string;
  message?: string;
  replyTo?: string;
  note?: string;
  title?: string;
  provider?: string;
  channelName?: string;
  topic?: string;
  space?: string;
  category?: string;
  files: string[];
  targets: string[];
  members: string[];
  positionals: string[];
};

type SingleOption = 'to' | 'chat' | 'timeout' | 'config' | 'confirm' | 'turns' | 'message' | 'replyTo' | 'note' | 'title' | 'provider' | 'channelName' | 'topic' | 'space' | 'category'
  | 'brief' | 'every' | 'at' | 'day' | 'timezone' | 'budget' | 'dailyCap' | 'rename'
  | 'query' | 'text' | 'language' | 'theme';

/** Options that take a value, written as `--to Researcher` or `--to=Researcher`. */
export const VALUE_OPTIONS = new Set(['--to', '--chat', '--file', '--timeout', '--config', '--confirm', '--turns', '--message', '--reply-to', '--note', '--target', '--with', '--title', '--provider', '--name', '--topic', '--space', '--category',
  '--brief', '--every', '--at', '--day', '--timezone', '--budget', '--daily-cap', '--rename', '--query', '--text', '--language', '--theme']);
/** The options of the library, memory and preferences commands, the field each fills and who takes it (COD-354). */
const LIBRARY_OPTIONS: readonly [string, SingleOption, CommandName][] = [['--query', 'query', 'library'], ['--text', 'text', 'memory'], ['--language', 'language', 'preferences'], ['--theme', 'theme', 'preferences']];
/** The options only `orglet schedule add` and `edit` take. */
const SCHEDULE_OPTIONS: readonly [string, SingleOption][] = [['--brief', 'brief'], ['--every', 'every'], ['--at', 'at'], ['--day', 'day'], ['--timezone', 'timezone'], ['--budget', 'budget'], ['--daily-cap', 'dailyCap'], ['--rename', 'rename']];
/** Options given at most once, and the field each one fills. */
const SINGLE_OPTIONS: Record<string, SingleOption> = {
  '--to': 'to',
  '--chat': 'chat',
  '--timeout': 'timeout',
  '--config': 'config',
  '--confirm': 'confirm',
  '--turns': 'turns',
  '--message': 'message',
  '--reply-to': 'replyTo',
  '--note': 'note',
  '--title': 'title',
  '--provider': 'provider',
  '--name': 'channelName',
  '--topic': 'topic',
  '--space': 'space',
  '--category': 'category',
  ...Object.fromEntries(SCHEDULE_OPTIONS),
  ...Object.fromEntries(LIBRARY_OPTIONS.map(([option, key]) => [option, key])),
};
/** The chat options added for COD-354 and the only commands that take each. */
const CHAT_OPTION_OWNERS: readonly { option: string; given: (options: Options) => boolean; commands: readonly CommandName[] }[] = [
  { option: '--chat', given: options => options.chat !== undefined, commands: [...CHAT_ID_COMMANDS, 'space'] },
  { option: '--turns', given: options => options.turns !== undefined, commands: ['read'] },
  { option: '--message', given: options => options.message !== undefined, commands: ['react', 'forward', 'bring', 'revise'] },
  { option: '--reply-to', given: options => options.replyTo !== undefined, commands: ['send'] },
  { option: '--note', given: options => options.note !== undefined, commands: ['forward'] },
  { option: '--target', given: options => options.targets.length > 0, commands: ['forward'] },
  { option: '--off', given: options => options.off, commands: ['react', 'schedule'] },
  { option: '--called', given: options => options.called, commands: ['schedule'] },
  { option: '--pin', given: options => options.pin, commands: ['memory'] },
  { option: '--unpin', given: options => options.unpin, commands: ['memory'] },
  { option: '--yes', given: options => options.yes, commands: ['memory'] },
  { option: '--refresh', given: options => options.refresh, commands: ['usage', 'models', 'market'] },
  ...LIBRARY_OPTIONS.map(([option, key, command]) => ({ option, given: (options: Options) => options[key] !== undefined, commands: [command] })),
  ...SCHEDULE_OPTIONS.map(([option, key]) => ({ option, given: (options: Options) => options[key] !== undefined, commands: (key === 'rename' ? ['schedule', 'space', 'rename'] : ['schedule']) as readonly CommandName[] })),
  { option: '--with', given: options => options.members.length > 0, commands: ['channel', 'group', 'members', 'space'] },
  { option: '--name', given: options => options.channelName !== undefined, commands: ['channel', 'group', 'space'] },
  { option: '--topic', given: options => options.topic !== undefined, commands: ['channel', 'group'] },
  { option: '--space', given: options => options.space !== undefined, commands: ['channel', 'group', 'chats', 'search', 'running'] },
  { option: '--category', given: options => options.category !== undefined, commands: ['channel', 'group', 'space'] },
  { option: '--title', given: options => options.title !== undefined, commands: ['rename'] },
  { option: '--provider', given: options => options.provider !== undefined, commands: ['template'] },
  { option: '--archived', given: options => options.archived, commands: ['chats'] },
];
/** Commands that take one positional value after their name: a message, a schedule, an emoji, an answer or a template. */
const VALUE_COMMANDS: readonly CommandName[] = ['completion', 'send', 'run', 'react', 'answer', 'revise', 'side', 'channel', 'group', 'template', 'search', 'library', 'models'];
/** Commands whose positionals may name an orglet or crew: `<orglet|channel> "<name>"`. */
const ENTITY_COMMANDS: readonly CommandName[] = ['create', 'edit', 'delete', 'archive', 'restore'];

function readOptions(argumentList: readonly string[]): Options {
  const options: Options = { help: false, version: false, json: false, wait: true, off: false, archived: false, called: false, pin: false, unpin: false, yes: false, refresh: false, files: [], targets: [], members: [], positionals: [] };
  let index = 0;
  while (index < argumentList.length) {
    const argument = argumentList[index];
    index += 1;
    if (argument === '--') {
      options.positionals.push(...argumentList.slice(index));
      break;
    }
    if (!argument.startsWith('-') || argument === '-') {
      options.positionals.push(argument);
      continue;
    }
    const equals = argument.indexOf('=');
    const name = equals === -1 ? argument : argument.slice(0, equals);
    if (VALUE_OPTIONS.has(name)) {
      let value: string | undefined;
      if (equals !== -1) {
        value = argument.slice(equals + 1);
      } else {
        value = argumentList[index];
        index += 1;
      }
      if (value === undefined || value === '') throw new UsageError(`${name} needs a value.`);
      assignValue(options, name, value);
      continue;
    }
    if (equals !== -1) throw new UsageError(`${name} does not take a value.`);
    assignFlag(options, name);
  }
  return options;
}

function assignValue(options: Options, name: string, value: string): void {
  if (name === '--file') {
    options.files.push(value);
    return;
  }
  if (name === '--target') {
    options.targets.push(value);
    return;
  }
  if (name === '--with') {
    options.members.push(value);
    return;
  }
  const key = SINGLE_OPTIONS[name];
  if (options[key] !== undefined) throw new UsageError(`${name} can be given once.`);
  options[key] = value;
}

function assignFlag(options: Options, name: string): void {
  if (name === '-h' || name === '--help') options.help = true;
  else if (name === '-v' || name === '--version') options.version = true;
  else if (name === '--json') options.json = true;
  else if (name === '--no-wait') options.wait = false;
  else if (name === '--off') options.off = true;
  else if (name === '--archived') options.archived = true;
  else if (name === '--called') options.called = true;
  else if (name === '--pin') options.pin = true;
  else if (name === '--unpin') options.unpin = true;
  else if (name === '--yes') options.yes = true;
  else if (name === '--refresh') options.refresh = true;
  else throw new UsageError(`Unknown option ${name}.`);
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_WAIT_SECONDS;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_WAIT_SECONDS) {
    throw new UsageError(`--timeout must be a whole number of seconds from 1 to ${MAX_WAIT_SECONDS}.`);
  }
  return seconds;
}

/** Whether the command names an orglet or crew with `<orglet|channel> "<name>"` rather than a chat. */
function namesEntity(command: CommandName, options: Options): boolean {
  if (!ENTITY_COMMANDS.includes(command)) return false;
  if (command === 'delete') return options.chat === undefined;
  return ['create', 'edit'].includes(command) || options.positionals[1] !== undefined;
}

/** Positionals after the command that nothing reads, which usually means a message with spaces lost its quotes. */
function extraPositionals(command: CommandName, options: Options): string[] {
  if (namesEntity(command, options)) return options.positionals.slice(command === 'create' ? 2 : 3);
  if (command === 'schedule' || command === 'memory' || command === 'space' || command === 'market') return options.positionals.slice(3);
  if (VALUE_COMMANDS.includes(command)) return options.positionals.slice(2);
  return options.positionals.slice(1);
}

/** Options that only one command understands, so `orglet list --file x` is a mistake rather than ignored. */
function rejectForeignOptions(command: CommandName, options: Options): void {
  if (!['create', 'edit'].includes(command) && options.config !== undefined) throw new UsageError('--config belongs to "orglet create" and "orglet edit".');
  if (!['delete', 'schedule', 'space', 'memory'].includes(command) && options.confirm !== undefined) throw new UsageError('--confirm belongs to the commands that delete: "orglet delete", "orglet schedule delete", "orglet space delete" and "orglet memory delete".');
  const waitOptions = !options.wait || options.timeout !== undefined;
  if (!WAITING_COMMANDS.includes(command) && waitOptions) throw new UsageError('--no-wait and --timeout belong to commands that wait for an answer, such as "orglet send".');
  const takesFiles = FILE_COMMANDS.includes(command);
  if (!takesFiles && options.files.length > 0) throw new UsageError(`--file belongs to the commands that send a message: ${FILE_COMMANDS.map(name => `"orglet ${name}"`).join(', ')}.`);
  if (!CHAT_COMMANDS.includes(command) && options.to !== undefined) throw new UsageError(`"orglet ${command}" does not take --to.`);
  for (const owner of CHAT_OPTION_OWNERS) {
    if (owner.given(options) && !owner.commands.includes(command)) throw new UsageError(`"orglet ${command}" does not take ${owner.option}.`);
  }
  if (command === 'chat' && options.json) throw new UsageError('"orglet chat" does not take --json. Use "orglet send --json" in scripts.');
  const extra = extraPositionals(command, options);
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}". Put a message with spaces in quotes.`);
}

function requireName(command: CommandName, to: string | undefined): string {
  const name = to?.trim();
  if (!name) throw new UsageError(`"orglet ${command}" needs --to <name>.`);
  return name;
}

function parseChatId(value: string): string {
  if (!ChatId.safeParse(value).success) throw new UsageError(t("--chat cần mã chat như orglet chats in ra, ít nhất bốn ký tự."));
  return value.trim().replace(/^#/, '');
}

function requireChatId(command: CommandName, chat: string | undefined): string {
  if (chat === undefined) throw new UsageError(`"orglet ${command}" needs --chat <id>. "orglet chats" lists them.`);
  return parseChatId(chat);
}

/** The chat a command names: `--to` an orglet or crew, or `--chat` an id, never both. */
function requireTarget(command: CommandName, options: Options): ChatTarget {
  if (options.to !== undefined && options.chat !== undefined) throw new UsageError(`"orglet ${command}" takes --to or --chat, not both.`);
  if (options.chat !== undefined) return { chat: parseChatId(options.chat) };
  return { to: requireName(command, options.to) };
}

export function parseArguments(argumentList: readonly string[]): ParsedCommand {
  const options = readOptions(argumentList);
  const [first] = options.positionals;
  if (first === undefined) {
    if (options.version) return { kind: 'version' };
    if (options.help) return { kind: 'help' };
    throw new UsageError('No command given.');
  }
  if (first === 'help') {
    const topic = options.positionals[1];
    return COMMAND_NAMES.includes(topic as CommandName) ? { kind: 'help', topic: topic as CommandName } : { kind: 'help' };
  }
  if (!COMMAND_NAMES.includes(first as CommandName)) throw new UsageError(`Unknown command "${first}".`);
  const command = first as CommandName;
  if (options.help) return { kind: 'help', topic: command };
  rejectForeignOptions(command, options);
  const json = options.json;
  switch (command) {
    case 'create':
    case 'edit': return parseManagement(command, options);
    case 'delete': return options.chat === undefined ? parseManagement(command, options) : parseChatDelete(options);
    case 'config': return { kind: 'config', json };
    case 'chat': return { kind: 'chat', ...(options.to?.trim() ? { to: options.to.trim() } : {}) };
    case 'status': return { kind: 'status', json };
    case 'list': return { kind: 'list', json };
    case 'read': return parseRead(options);
    case 'open': return { kind: 'open', ...(options.to?.trim() ? { to: options.to.trim() } : {}), json };
    case 'send': return parseSend(options);
    case 'run': return parseRun(options);
    case 'react': return parseReact(options);
    case 'forward': return parseForward(options);
    case 'answer': return parseAnswer(options);
    case 'revise': return parseRevise(options);
    case 'stop':
    case 'pause':
    case 'resume':
    case 'retry':
    case 'continue': return parseControl(command, options);
    case 'chats': return { kind: 'chats', archived: options.archived, ...(options.space?.trim() ? { space: options.space.trim() } : {}), json };
    case 'side': return parseSide(options);
    case 'bring': return parseBring(options);
    case 'channel':
    case 'group': return parseChannel(command, options);
    case 'members': return parseMembers(options);
    case 'rename': return parseRename(options);
    case 'archive':
    case 'restore': return parseArchive(command, options);
    case 'template': return parseTemplate(options);
    case 'schedules': return { kind: 'schedules', json };
    case 'spaces': return { kind: 'spaces', json };
    case 'space': return parseSpace(options);
    case 'market': return parseMarket(options);
    case 'completion': {
      const shell = COMPLETION_SHELLS.find(item => item === options.positionals[1]);
      if (!shell) throw new UsageError(t("Gõ powershell, bash hoặc zsh sau orglet completion."));
      return { kind: 'completion', shell };
    }
    case 'schedule': return parseSchedule(options);
    case 'search': return parseSearch(options);
    case 'running': return { kind: 'running', ...(options.space?.trim() ? { space: options.space.trim() } : {}), json };
    case 'library': return parseLibrary(options);
    case 'memory': return parseMemory(options);
    case 'usage': return { kind: 'usage', refresh: options.refresh, json };
    case 'models': return parseModels(options);
    case 'preferences': return parsePreferences(options);
  }
}

/**
 * What `<orglet|channel> "<name>"` names. Crews are channels where the lead splits the work since COD-369, so `channel`
 * names the same record, and `crew` and `team` stay as the older names.
 */
function entityKind(entityName: string | undefined): 'worker' | 'team' {
  if (entityName === 'orglet') return 'worker';
  if (entityName === 'channel' || entityName === 'crew' || entityName === 'team') return 'team';
  throw new UsageError(t("Gõ orglet hoặc channel sau lệnh."));
}

function parseManagement(kind: 'create' | 'edit' | 'delete', options: Options): ManagementCommand {
  const entityName = options.positionals[1];
  const entity = entityKind(entityName);
  const name = options.positionals[2]?.trim();
  if (kind !== 'create' && !name) throw new UsageError(t("Gõ tên đầy đủ của Tí hoặc kênh."));
  if (kind === 'delete' && !options.confirm) throw new UsageError(t("Xóa cần --confirm \"<tên đầy đủ>\"."));
  if (kind !== 'delete' && !options.config) throw new UsageError(t("Gõ --config <file.json>, hoặc dùng /new và /edit trong TUI."));
  return { kind, entity, ...(name ? { name } : {}), ...(options.config ? { config: options.config } : {}), ...(options.confirm ? { confirm: options.confirm } : {}), json: options.json };
}

function parseRun(options: Options): ParsedCommand {
  const schedule = options.positionals[1]?.trim();
  if (!schedule) throw new UsageError('"orglet run" needs a schedule name, for example: orglet run "Invoice check"');
  if (options.files.length > MAX_FILES) throw new UsageError(`Attach at most ${MAX_FILES} files.`);
  return { kind: 'run', schedule, files: options.files, json: options.json };
}

/** The files of a message that takes them as an option, kept out of the command when there are none. */
function filesOf(options: Options): { files?: string[] } {
  if (options.files.length > MAX_FILES) throw new UsageError(`Attach at most ${MAX_FILES} files.`);
  return options.files.length > 0 ? { files: options.files } : {};
}

function parseSend(options: Options): ParsedCommand {
  const message = options.positionals[1]?.trim();
  if (!message) throw new UsageError('"orglet send" needs a message, for example: orglet send "Hello" --to Researcher');
  if (options.files.length > MAX_FILES) throw new UsageError(`Attach at most ${MAX_FILES} files.`);
  const replyTo = options.replyTo === undefined ? {} : { replyTo: parseMessageRef('--reply-to', options.replyTo) };
  return {
    kind: 'send',
    message,
    ...requireTarget('send', options),
    files: options.files,
    wait: options.wait,
    timeoutSeconds: parseTimeout(options.timeout),
    json: options.json,
    ...replyTo,
  };
}

function parseRead(options: Options): ParsedCommand {
  const target = requireTarget('read', options);
  if (options.turns === undefined) return { kind: 'read', ...target, json: options.json };
  const turns = Number(options.turns);
  if (!Number.isInteger(turns) || turns < 1 || turns > MAX_READ_TURNS) throw new UsageError(t("--turns cần là số nguyên từ 1 đến {0}.", MAX_READ_TURNS));
  return { kind: 'read', ...target, turns, json: options.json };
}

/** A message number as `read --turns` prints it: `3`, `3.1`, `#3.1` or `last`. */
function parseMessageRef(option: string, value: string): string {
  if (!MessageRef.safeParse(value).success) throw new UsageError(t("{0} cần số tin nhắn như 3, 3.1 hoặc last.", option));
  return value.trim();
}

function parseReact(options: Options): ParsedCommand {
  const emoji = Reaction.safeParse(options.positionals[1]?.trim().toLowerCase());
  if (!emoji.success) throw new UsageError(t("Gõ một cảm xúc: {0}.", Reaction.options.join(', ')));
  const message = options.message === undefined ? {} : { message: parseMessageRef('--message', options.message) };
  return { kind: 'react', ...requireTarget('react', options), emoji: emoji.data, active: !options.off, ...message, json: options.json };
}

function parseForward(options: Options): ParsedCommand {
  const targets = options.targets.map(target => target.trim()).filter(Boolean);
  if (targets.length === 0) throw new UsageError(t("Chuyển tiếp cần ít nhất một --target <tên>."));
  if (targets.length > MAX_FORWARD_TARGETS) throw new UsageError(t("Chuyển tiếp tối đa {0} nơi.", MAX_FORWARD_TARGETS));
  const message = options.message === undefined ? {} : { message: parseMessageRef('--message', options.message) };
  const note = options.note?.trim() ? { note: options.note.trim() } : {};
  return { kind: 'forward', ...requireTarget('forward', options), targets, ...message, ...note, json: options.json };
}

function parseRevise(options: Options): ParsedCommand {
  const text = options.positionals[1]?.trim();
  const message = UserMessageRef.safeParse(options.message);
  if (!text || !message.success) throw new UsageError(t('Gõ orglet revise \"chữ đã sửa\" --to Researcher --message 3. Chỉ sửa được tin nhắn của bạn.'));
  return { kind: 'revise', text, message: message.data, ...requireTarget('revise', options), ...filesOf(options), wait: options.wait, timeoutSeconds: parseTimeout(options.timeout), json: options.json };
}

function parseAnswer(options: Options): ParsedCommand {
  const answer = options.positionals[1]?.trim();
  if (!answer) throw new UsageError(t("Gõ câu trả lời, ví dụ: orglet answer 1 --to Researcher"));
  return { kind: 'answer', ...requireTarget('answer', options), answer, wait: options.wait, timeoutSeconds: parseTimeout(options.timeout), json: options.json };
}

function parseControl(action: ChatControl, options: Options): ParsedCommand {
  return { kind: 'control', action, ...requireTarget(action, options), wait: options.wait, timeoutSeconds: parseTimeout(options.timeout), json: options.json };
}

function parseSide(options: Options): ParsedCommand {
  const message = options.positionals[1]?.trim();
  if (!message) throw new UsageError(t("Gõ tin nhắn cho chat phụ, ví dụ: orglet side \"Thử cách khác\" --to Researcher"));
  return { kind: 'side', message, ...requireTarget('side', options), ...filesOf(options), wait: options.wait, timeoutSeconds: parseTimeout(options.timeout), json: options.json };
}

function parseBring(options: Options): ParsedCommand {
  const message = options.message === undefined ? {} : { message: parseMessageRef('--message', options.message) };
  return { kind: 'bring', chat: requireChatId('bring', options.chat), ...message, json: options.json };
}

/** The orglets and crews given with --with, at least one (COD-361). */
function memberNames(options: Options): string[] {
  const names = options.members.map(name => name.trim()).filter(Boolean);
  if (!names.length) throw new UsageError(t("Kênh cần ít nhất một --with <tên Tí>."));
  return names;
}

/** `orglet channel`, and `orglet group`, its older name: a new channel with its first message. */
function parseChannel(command: 'channel' | 'group', options: Options): ParsedCommand {
  const message = options.positionals[1]?.trim();
  const name = options.channelName?.trim();
  // With a name and no message the channel is only created, as New channel in the app does.
  if (!message && !name) throw new UsageError(t("Gõ tin nhắn đầu tiên, ví dụ: orglet {0} \"Chào cả kênh\" --with Researcher --with Writer", command));
  const topic = options.topic?.trim();
  const space = options.space?.trim();
  const category = options.category?.trim();
  if (options.space !== undefined && !space) throw new UsageError(t("Gõ tên không gian sau --space."));
  if (options.category !== undefined && !category) throw new UsageError(t("Gõ tên mục sau --category."));
  if (options.files.length > 0 && !message) throw new UsageError(t("Tệp đi kèm tin nhắn đầu tiên của kênh. Gõ tin nhắn, hoặc bỏ --file."));
  if (category && !space) throw new UsageError(t("--category cần --space <tên không gian>."));
  // In a space a channel with no --with takes every orglet of its place.
  const names = space && !options.members.some(member => member.trim()) ? [] : memberNames(options);
  return {
    kind: 'channel', names, ...(message ? { message } : {}), ...filesOf(options), ...(name ? { name } : {}), ...(topic ? { topic } : {}),
    ...(space ? { space } : {}), ...(category ? { category } : {}),
    wait: options.wait, timeoutSeconds: parseTimeout(options.timeout), json: options.json,
  };
}

function parseMembers(options: Options): ParsedCommand {
  return { kind: 'members', chat: requireChatId('members', options.chat), names: memberNames(options), json: options.json };
}

/** `--rename` is the one every command that renames takes; `--title` is the older spelling here. */
function parseRename(options: Options): ParsedCommand {
  if (options.title !== undefined && options.rename !== undefined) throw new UsageError(t("Chọn --rename hoặc --title, không phải cả hai."));
  const title = (options.rename ?? options.title)?.trim();
  if (!title) throw new UsageError(t("Đổi tên cần --rename \"<tên mới>\"."));
  return { kind: 'chat-change', change: 'rename', ...requireTarget('rename', options), title, json: options.json };
}

function parseChatDelete(options: Options): ParsedCommand {
  const confirmName = options.confirm?.trim();
  if (!confirmName) throw new UsageError(t("Xóa chat cần --confirm \"<tên chat>\" đúng như orglet chats in ra."));
  return { kind: 'chat-change', change: 'delete', chat: parseChatId(options.chat!), confirmName, json: options.json };
}

/** `archive --to X`, `restore --chat <id>`, or `archive|restore <orglet|channel> "<name>"`. */
function parseArchive(command: 'archive' | 'restore', options: Options): ParsedCommand {
  const archived = command === 'archive';
  const entityName = options.positionals[1];
  if (entityName === undefined) {
    if (archived) return { kind: 'chat-change', change: 'archive', ...requireTarget(command, options), json: options.json };
    return { kind: 'chat-change', change: 'restore', chat: requireChatId(command, options.chat), json: options.json };
  }
  const entity = entityKind(entityName);
  if (options.to !== undefined || options.chat !== undefined) throw new UsageError(`"orglet ${command} ${entityName}" takes a name, not --to or --chat.`);
  const name = options.positionals[2]?.trim();
  if (!name) throw new UsageError(t("Gõ tên đầy đủ của Tí hoặc kênh."));
  return { kind: 'archive-entity', entity, name, archived, json: options.json };
}

function parseTemplate(options: Options): ParsedCommand {
  const templateId = TEMPLATE_IDS.find(id => id === options.positionals[1]);
  if (!templateId) throw new UsageError(t("Chọn một mẫu: {0}.", TEMPLATE_IDS.join(', ')));
  // `demo` stays accepted for the tests and smokes that run with sample replies; nothing offers it to a person.
  if (options.provider !== 'demo' && options.provider !== 'openai') throw new UsageError(t("Mẫu cần --provider openai."));
  return { kind: 'template', templateId, provider: options.provider, json: options.json };
}

/** `orglet market`, `orglet market installed` and `orglet market add <id>`. */
function parseMarket(options: Options): ParsedCommand {
  const verb = options.positionals[1] ?? 'list';
  if (verb !== 'list' && verb !== 'installed' && verb !== 'add') throw new UsageError(t("Gõ installed hoặc add <mã> sau orglet market, hoặc không gõ gì để xem danh mục."));
  const listingId = options.positionals[2]?.trim();
  if (verb !== 'add' && listingId) throw new UsageError(t("Chỉ orglet market add nhận một mã."));
  if (verb !== 'list' && options.refresh) throw new UsageError(t("--refresh chỉ dùng khi xem danh mục."));
  if (verb !== 'add') return { kind: 'market', verb, refresh: options.refresh, json: options.json };
  if (!listingId || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(listingId)) throw new UsageError(t("Gõ mã của mục như orglet market in ra, ví dụ: orglet market add launch-space"));
  return { kind: 'market', verb, listingId, refresh: false, json: options.json };
}

const SPACE_VERBS = ['add', 'edit', 'category', 'uncategory', 'move', 'out', 'delete'] as const;

/** `orglet space`: a space's own changes, its categories, and a channel moved into or out of one. */
function parseSpace(options: Options): ParsedCommand {
  const verb = SPACE_VERBS.find(item => item === options.positionals[1]);
  if (!verb) throw new UsageError(t("Gõ add, edit, category, uncategory, move, out hoặc delete sau orglet space."));
  const space = options.positionals[2]?.trim();
  if (verb === 'out' && space) throw new UsageError(t("orglet space out chỉ nhận --chat <mã> hoặc --name <tên kênh>."));
  if (verb !== 'out' && !space) throw new UsageError(t("Gõ tên không gian, ví dụ: orglet space {0} \"Launch\"", verb));
  const names = options.members.map(name => name.trim()).filter(Boolean);
  const rename = options.rename?.trim();
  const category = options.category?.trim();
  const channelName = options.channelName?.trim().replace(/^#/, '');
  const takes = (allowed: readonly string[], option: string, given: boolean) => {
    if (given && !allowed.includes(verb)) throw new UsageError(t("orglet space {0} không nhận {1}.", verb, option));
  };
  takes(['add', 'edit', 'category'], '--with', names.length > 0);
  takes(['edit', 'category'], '--rename', options.rename !== undefined);
  takes(['category', 'uncategory', 'move'], '--category', options.category !== undefined);
  takes(['move', 'out'], '--chat', options.chat !== undefined);
  takes(['move', 'out'], '--name', options.channelName !== undefined);
  takes(['delete'], '--confirm', options.confirm !== undefined);
  const base = { kind: 'space' as const, verb, names, json: options.json, ...(space ? { space } : {}) };
  if (verb === 'add') {
    if (!names.length) throw new UsageError(t("Không gian cần ít nhất một --with <tên Tí>."));
    return base;
  }
  if (verb === 'edit') {
    if (!names.length && !rename) throw new UsageError(t("orglet space edit cần --rename hoặc --with."));
    return { ...base, ...(rename ? { rename } : {}) };
  }
  if (verb === 'category' || verb === 'uncategory') {
    if (!category) throw new UsageError(t("Gõ tên mục sau --category."));
    return { ...base, category, ...(rename ? { rename } : {}) };
  }
  if (verb === 'move' || verb === 'out') {
    // A channel with no message yet has no chat id, so it is named instead.
    if ((options.chat === undefined) === (channelName === undefined)) throw new UsageError(t("Chỉ kênh cần chuyển bằng --chat <mã> hoặc --name <tên kênh>, một trong hai."));
    const channel = channelName ? { channelName } : { chat: requireChatId('space', options.chat) };
    return { ...base, ...channel, ...(verb === 'move' && category ? { category } : {}) };
  }
  const confirmName = options.confirm?.trim();
  if (!confirmName) throw new UsageError(t("Xóa không gian cần --confirm \"<tên không gian>\"."));
  return { ...base, confirmName };
}

const SCHEDULE_VERBS = ['add', 'edit', 'on', 'off', 'delete'] as const;
/** Weekday names `--day` takes, in the schedule's numbering: 0 is Sunday. */
const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MICROS_PER_USD = 1_000_000;
const MAX_RUN_BUDGET_MICROS = 100_000_000;

/** `orglet schedule <add|edit|on|off|delete> "<name>" [options]`. */
function parseSchedule(options: Options): ParsedCommand {
  const verb = SCHEDULE_VERBS.find(item => item === options.positionals[1]);
  if (!verb) throw new UsageError(t("Gõ add, edit, on, off hoặc delete sau orglet schedule."));
  const schedule = options.positionals[2]?.trim();
  if (!schedule) throw new UsageError(t("Gõ tên lịch, ví dụ: orglet schedule {0} \"Review sáng\"", verb));
  const changes = SCHEDULE_OPTIONS.some(([, key]) => options[key] !== undefined) || options.to !== undefined || options.called || options.off;
  if ((verb === 'on' || verb === 'off' || verb === 'delete') && changes) throw new UsageError(t("orglet schedule {0} chỉ nhận tên lịch.", verb));
  if (verb !== 'delete' && options.confirm !== undefined) throw new UsageError('--confirm belongs to "orglet schedule delete".');
  if (verb === 'on' || verb === 'off') return { kind: 'schedule-enable', schedule, enabled: verb === 'on', json: options.json };
  if (verb === 'delete') {
    const confirmName = options.confirm?.trim();
    if (!confirmName) throw new UsageError(t("Xóa lịch cần --confirm \"<tên lịch>\"."));
    return { kind: 'schedule-delete', schedule, confirmName, json: options.json };
  }
  if (verb === 'add' && options.rename !== undefined) throw new UsageError(t("--rename chỉ dùng với orglet schedule edit."));
  const fields = scheduleFields(options);
  if (verb === 'add') return { kind: 'schedule-save', fields: { ...fields, name: schedule }, json: options.json };
  if (options.off) throw new UsageError(t("Dùng orglet schedule off để tắt một lịch."));
  return { kind: 'schedule-save', schedule, fields, json: options.json };
}

function scheduleFields(options: Options): ScheduleFields {
  const every = options.every === undefined ? {} : parseEvery(options.every);
  return {
    ...(options.rename?.trim() ? { name: options.rename.trim() } : {}),
    ...(options.to?.trim() ? { target: options.to.trim() } : {}),
    ...(options.brief?.trim() ? { brief: options.brief.trim() } : {}),
    ...every,
    ...(options.at !== undefined ? { time: parseClock(options.at) } : {}),
    ...(options.day !== undefined ? { weekday: parseWeekday(options.day) } : {}),
    ...(options.timezone?.trim() ? { timeZone: options.timezone.trim() } : {}),
    ...(options.budget !== undefined ? { budgetMicros: parseUsd('--budget', options.budget, MAX_RUN_BUDGET_MICROS) } : {}),
    ...(options.dailyCap !== undefined ? { dailyCapMicros: parseUsd('--daily-cap', options.dailyCap, MAX_DAILY_CAP_MICROS) } : {}),
    ...(options.called ? { trigger: 'called' as const } : {}),
    ...(options.off ? { enabled: false } : {}),
  };
}

/** `daily`, `weekdays`, `weekly`, or every few hours as `2h`. */
function parseEvery(value: string): Pick<ScheduleFields, 'frequency' | 'everyHours'> {
  const wanted = value.trim().toLowerCase();
  if (wanted === 'daily' || wanted === 'weekdays' || wanted === 'weekly') return { frequency: wanted };
  const hours = Number(wanted.match(/^(\d{1,2})h$/)?.[1]);
  const choice = EVERY_HOURS_CHOICES.find(item => item === hours);
  if (choice === undefined) throw new UsageError(t("--every cần daily, weekdays, weekly hoặc số giờ: {0}.", EVERY_HOURS_CHOICES.map(item => `${item}h`).join(', ')));
  return { frequency: 'hours', everyHours: choice };
}

function parseClock(value: string): string {
  const time = value.trim().padStart(5, '0');
  if (!ClockTime.safeParse(time).success) throw new UsageError(t("--at cần giờ dạng HH:MM, ví dụ 08:30."));
  return time;
}

function parseWeekday(value: string): number {
  const index = WEEKDAY_NAMES.indexOf(value.trim().toLowerCase().slice(0, 3));
  if (index === -1) throw new UsageError(t("--day cần một ngày: {0}.", WEEKDAY_NAMES.join(', ')));
  return index;
}

function parseSearch(options: Options): ParsedCommand {
  const query = options.positionals[1]?.trim();
  if (!query) throw new UsageError(t("Gõ từ cần tìm, ví dụ: orglet search \"hợp đồng\""));
  return { kind: 'search', query, ...(options.space?.trim() ? { space: options.space.trim() } : {}), json: options.json };
}

/** `library [memory|notes]`: memories by default. */
function parseLibrary(options: Options): ParsedCommand {
  const kind = options.positionals[1] ?? 'memory';
  if (kind !== 'memory' && kind !== 'memories' && kind !== 'notes' && kind !== 'note') throw new UsageError(t("Gõ memory hoặc notes sau orglet library."));
  const query = options.query?.trim() ? { query: options.query.trim() } : {};
  const owner = options.to?.trim() ? { owner: options.to.trim() } : {};
  return { kind: 'library', library: kind.startsWith('memor') ? 'memory' : 'note', ...query, ...owner, json: options.json };
}

/** `memory edit <id> [--text …] [--pin|--unpin]` or `memory delete <id> --yes`. */
function parseMemory(options: Options): ParsedCommand {
  const verb = options.positionals[1];
  if (verb !== 'edit' && verb !== 'delete') throw new UsageError(t("Gõ edit hoặc delete sau orglet memory."));
  const id = options.positionals[2]?.trim();
  if (!id || !ChatId.safeParse(id).success) throw new UsageError(t("Gõ mã ghi nhớ như orglet library memory in ra."));
  const memoryId = id.replace(/^#/, '');
  if (verb === 'delete') {
    if (options.text !== undefined || options.pin || options.unpin) throw new UsageError(t("orglet memory delete chỉ nhận mã và --confirm."));
    if (options.yes && options.confirm !== undefined) throw new UsageError(t("Chọn --confirm hoặc --yes, không phải cả hai."));
    if (!options.yes && !options.confirm?.trim()) throw new UsageError(t("Xóa ghi nhớ là vĩnh viễn. Thêm --confirm \"<mã hoặc nội dung>\" để xác nhận."));
    return { kind: 'memory-delete', id: memoryId, ...(options.confirm?.trim() ? { confirm: options.confirm.trim() } : {}), json: options.json };
  }
  if (options.yes) throw new UsageError('--yes belongs to "orglet memory delete".');
  if (options.confirm !== undefined) throw new UsageError('--confirm belongs to "orglet memory delete".');
  if (options.pin && options.unpin) throw new UsageError(t("Chọn --pin hoặc --unpin, không phải cả hai."));
  const text = options.text?.trim() ? { text: options.text.trim() } : {};
  const pinned = options.pin ? { pinned: true } : options.unpin ? { pinned: false } : {};
  if (!('text' in text) && !('pinned' in pinned)) throw new UsageError(t("Sửa ghi nhớ cần --text, --pin hoặc --unpin."));
  return { kind: 'memory-edit', id: memoryId, ...text, ...pinned, json: options.json };
}

/** `models <provider>` or `models --to <orglet>`. */
function parseModels(options: Options): ParsedCommand {
  const typed = options.positionals[1]?.trim();
  if (typed && options.to !== undefined) throw new UsageError(t("Gõ một provider hoặc --to <tên Tí>, không phải cả hai."));
  if (!typed && !options.to?.trim()) throw new UsageError(t("Gõ một provider như openai, hoặc --to <tên Tí>."));
  if (!typed) return { kind: 'models', to: options.to!.trim(), refresh: options.refresh, json: options.json };
  const provider = ProviderId.safeParse(typed);
  if (!provider.success) throw new UsageError(t("Không có provider \"{0}\". orglet config --json liệt kê các kết nối.", typed));
  return { kind: 'models', provider: provider.data, refresh: options.refresh, json: options.json };
}

const LANGUAGES = ['vi', 'en', 'en-GB'] as const;
const THEMES = ['system', 'light', 'dark'] as const;

function parsePreferences(options: Options): ParsedCommand {
  const language = LANGUAGES.find(item => item.toLowerCase() === options.language?.trim().toLowerCase());
  if (options.language !== undefined && !language) throw new UsageError(t("--language cần {0}.", LANGUAGES.join(', ')));
  const theme = THEMES.find(item => item === options.theme?.trim().toLowerCase());
  if (options.theme !== undefined && !theme) throw new UsageError(t("--theme cần {0}.", THEMES.join(', ')));
  return { kind: 'preferences', ...(language ? { language } : {}), ...(theme ? { theme } : {}), json: options.json };
}

/** A USD amount with up to six decimals, kept as integer micros the way the app stores money. */
function parseUsd(option: string, value: string, maximumMicros: number): number {
  const trimmed = value.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) throw new UsageError(t("{0} cần số tiền USD như 0.50.", option));
  const micros = Math.round(Number(trimmed) * MICROS_PER_USD);
  if (micros < 1000 || micros > maximumMicros) throw new UsageError(t("{0} cần từ 0.001 đến {1} USD.", option, maximumMicros / MICROS_PER_USD));
  return micros;
}
