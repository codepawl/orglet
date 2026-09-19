import { containsKeyword, normalizeRoleText, roleWords } from './role-words';
import type { Skill, Task, Team, Worker } from './contracts';

/*
 * What an empty chat offers before anyone has typed. The openers come from this workspace, so a worker hired to write
 * release notes is not asked whether it wants an evidence-based review.
 *
 * Everything here is computed locally from data the app already has. There is no model call to decide what to suggest,
 * and nothing leaves the machine. A starter only fills the composer; it never sends on its own.
 */

/** Which icon the renderer draws beside a starter. Names describe the work, not a lucide component. */
export type StarterIcon = 'documents' | 'review' | 'write' | 'data' | 'plan' | 'code' | 'people' | 'repeat';

export type Starter = {
  /** Stable across renders and languages, so React keys and tests do not depend on the text. */
  id: string;
  icon: StarterIcon;
  /** The row text. Vietnamese source text unless `ownWords`, when it is the person's own writing. */
  label: string;
  /** What goes into the composer. Vietnamese source text unless `ownWords`. */
  prompt: string;
  /** The label and prompt are the person's own words: show and send them exactly, never translated. */
  ownWords?: boolean;
};

type StarterTemplate = Omit<Starter, 'ownWords'> & {
  /** Only offered while something is attached to the chat, because it reads the attachments. */
  needsSources?: boolean;
};

/*
 * Role lexicon. Each entry gives the openers that fit a role and the words that name it, written lowercase without
 * diacritics under the rules in role-words.ts. An entry's first starter is its strongest, and the score decides the
 * order between entries, so a worker that matches two roles leads with the one its name and description point at.
 */
const roleStarters: { words: string[]; starters: StarterTemplate[] }[] = [
  {
    words: ['research', 'nghien cuu', 'tim kiem', 'tra cuu', 'search', 'investigat', 'khao sat', 'survey', 'source', 'nguon tin', 'literature', 'tham khao', 'kiem chung', 'fact check', 'dieu tra'],
    starters: [
      { id: 'research-landscape', icon: 'documents', label: 'Tìm hiểu chủ đề này', prompt: 'Tìm hiểu chủ đề sau và tóm tắt những gì đã biết, kèm nguồn cho từng ý: ' },
      { id: 'research-verify', icon: 'review', label: 'Kiểm chứng một khẳng định', prompt: 'Kiểm chứng khẳng định sau. Nói rõ nó đúng, sai hay chưa đủ căn cứ, và dựa vào đâu: ' },
    ],
  },
  {
    words: ['data', 'du lieu', 'scor', 'chart', 'bieu do', 'phan tich', 'analy', 'metric', 'so lieu', 'thong ke', 'statistic', 'dashboard', 'excel', 'spreadsheet', 'bang tinh', 'sql', 'insight', 'forecast', 'du bao', 'benchmark'],
    starters: [
      { id: 'data-notable', icon: 'data', label: 'Chỉ ra điều đáng chú ý trong số liệu', prompt: 'Xem số liệu đã đính kèm và chỉ ra điều đáng chú ý: xu hướng, giá trị bất thường, và điều gì chưa đủ dữ liệu để kết luận.', needsSources: true },
      { id: 'data-question', icon: 'data', label: 'Trả lời một câu hỏi bằng số liệu', prompt: 'Dùng số liệu để trả lời câu hỏi sau, nêu rõ cách tính và giới hạn của câu trả lời: ' },
    ],
  },
  {
    words: ['review', 'duyet', 'kiem tra', 'check', 'audit', 'qa', 'test', 'danh gia', 'evaluat', 'verif', 'xac minh', 'chat luong', 'quality', 'soat loi', 'proofread', 'validat', 'grader', 'cham diem', 'phan bien', 'rubric'],
    starters: [
      { id: 'review-evidence', icon: 'review', label: 'Review có bằng chứng', prompt: 'Review các tệp đã đính kèm. Nêu vấn đề kèm bằng chứng, nói rõ đã kiểm tra tới đâu và còn giới hạn gì. Không thực thi code.', needsSources: true },
      { id: 'review-secondopinion', icon: 'review', label: 'Cho ý kiến ngược lại', prompt: 'Đọc phần sau và phản biện: chỗ nào yếu, chỗ nào mình đang cho là đúng mà chưa có căn cứ: ' },
    ],
  },
  {
    words: ['secur', 'bao mat', 'risk', 'rui ro', 'complian', 'tuan thu', 'legal', 'phap ly', 'phap che', 'luat su', 'lawyer', 'privacy', 'rieng tu', 'an toan', 'gdpr', 'policy', 'fraud', 'gian lan'],
    starters: [
      { id: 'risk-scan', icon: 'review', label: 'Soát rủi ro', prompt: 'Soát phần sau và liệt kê rủi ro thật sự, xếp theo mức nghiêm trọng, kèm lý do cho từng cái: ' },
    ],
  },
  {
    words: ['writ', 'viet bai', 'bien soan', 'soan thao', 'content', 'noi dung', 'copy', 'editor', 'bien tap', 'tai lieu', 'synthes', 'tong hop', 'summar', 'tom tat', 'translat', 'dich thuat', 'blog', 'article', 'bai viet', 'proposal', 'release note', 'changelog'],
    starters: [
      { id: 'write-draft', icon: 'write', label: 'Viết bản nháp đầu tiên', prompt: 'Viết bản nháp đầu tiên cho: ' },
      { id: 'write-tighten', icon: 'write', label: 'Rút gọn cho dễ đọc', prompt: 'Rút gọn đoạn sau, giữ nguyên ý và bỏ phần thừa: ' },
    ],
  },
  {
    words: ['code', 'lap trinh', 'developer', 'engineer', 'ky thuat', 'debug', 'refactor', 'api', 'backend', 'frontend', 'devops', 'script', 'sua loi', 'bug'],
    starters: [
      { id: 'code-explain', icon: 'code', label: 'Giải thích đoạn code này', prompt: 'Giải thích đoạn code đã đính kèm làm gì, và chỗ nào dễ hiểu sai: ', needsSources: true },
      { id: 'code-approach', icon: 'code', label: 'Bàn cách làm', prompt: 'Mình đang định làm thế này. Nói xem cách nào gọn hơn và cách của mình hỏng ở đâu: ' },
    ],
  },
  {
    words: ['support', 'ho tro', 'khach hang', 'customer', 'cham soc', 'helpdesk', 'ticket', 'phan hoi', 'feedback', 'cong dong', 'community', 'tuyen dung', 'nhan su'],
    starters: [
      { id: 'people-reply', icon: 'people', label: 'Soạn câu trả lời', prompt: 'Soạn câu trả lời cho tin nhắn sau. Ngắn, thẳng, không hứa điều mình chưa chắc: ' },
    ],
  },
  {
    words: ['plan', 'ke hoach', 'lich trinh', 'project', 'du an', 'quan ly', 'manager', 'roadmap', 'sprint', 'backlog', 'dieu phoi', 'to chuc'],
    starters: [
      { id: 'plan-steps', icon: 'plan', label: 'Chia việc này thành các bước', prompt: 'Chia việc sau thành các bước làm được, nói rõ bước nào chặn bước nào: ' },
    ],
  },
  {
    words: ['marketing', 'truyen thong', 'quang cao', 'thuong hieu', 'brand', 'social', 'seo', 'chien dich', 'campaign', 'ra mat', 'launch'],
    starters: [
      { id: 'announce-short', icon: 'write', label: 'Viết thông báo ngắn', prompt: 'Viết thông báo ngắn cho: ' },
    ],
  },
  {
    words: ['finance', 'tai chinh', 'ke toan', 'accounting', 'chi phi', 'doanh thu', 'invoice', 'hoa don', 'ngan sach', 'budget', 'thue', 'tax'],
    starters: [
      { id: 'finance-check', icon: 'data', label: 'Kiểm tra các con số', prompt: 'Kiểm tra các con số trong tệp đã đính kèm: chỗ nào không khớp, chỗ nào thiếu.', needsSources: true },
    ],
  },
];

// Offered when a chat has attachments but the worker's role did not ask for anything more specific.
const sourceStarters: StarterTemplate[] = [
  { id: 'sources-summary', icon: 'documents', label: 'Tóm tắt tài liệu đã đính kèm', prompt: 'Đọc các tài liệu đã đính kèm, tóm tắt những điểm chính và chỉ rõ phần còn thiếu bằng chứng.', needsSources: true },
];

// The last resort, so an empty chat is never blank: openers that work for any worker on any day.
const genericStarters: StarterTemplate[] = [
  { id: 'generic-ask', icon: 'people', label: 'Hỏi xem giúp được gì', prompt: 'Với những gì bạn được giao, bạn giúp mình được những việc gì? Hỏi lại nếu cần biết thêm.' },
  { id: 'generic-steps', icon: 'plan', label: 'Chia việc thành các bước', prompt: 'Chia việc sau thành các bước làm được, nói rõ bước nào chặn bước nào: ' },
];

// A team chat opens on the whole team, not on one member.
const teamStarters: StarterTemplate[] = [
  { id: 'team-split', icon: 'plan', label: 'Giao việc này cho cả hội', prompt: 'Việc sau cần cả hội. Chia ra ai làm phần nào, rồi gộp lại thành một kết quả: ' },
];

/** Shown as a row: a long brief is cut at a word so the list stays one line per starter. */
const LABEL_LIMIT = 64;
const shorten = (text: string) => {
  const single = text.replace(/\s+/g, ' ').trim();
  if (single.length <= LABEL_LIMIT) return single;
  const cut = single.slice(0, LABEL_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > LABEL_LIMIT / 2 ? lastSpace : LABEL_LIMIT).trimEnd()}…`;
};

/** How many times the same brief must have been sent before it counts as something this person repeats. */
const REPEAT_THRESHOLD = 2;
const HISTORY_LIMIT = 2;

/**
 * Briefs already sent to this chat more than once, most repeated first. A one-off message is not an opener, so only
 * a repeated one is offered; that keeps a stale question out of the list while a weekly routine shows up on its own.
 */
function historyStarters(tasks: readonly Task[]): Starter[] {
  const counts = new Map<string, { brief: string; count: number }>();
  for (const task of tasks) {
    if (task.deletedAt) continue;
    const brief = task.brief.replace(/\s+/g, ' ').trim();
    if (!brief) continue;
    const key = normalizeRoleText(brief);
    const seen = counts.get(key);
    if (seen) seen.count++;
    else counts.set(key, { brief, count: 1 });
  }
  return [...counts.values()]
    .filter(entry => entry.count >= REPEAT_THRESHOLD)
    .sort((first, second) => second.count - first.count)
    .slice(0, HISTORY_LIMIT)
    .map((entry, index) => ({ id: `history-${index}`, icon: 'repeat' as const, label: shorten(entry.brief), prompt: entry.brief, ownWords: true }));
}

// The name says what a worker is for in a couple of words; long instructions only nudge, and are cut so a pasted
// document cannot outweigh everything else.
const roleFields = [['name', 4], ['description', 2.5], ['skill', 2], ['instructions', 1]] as const;
const INSTRUCTION_LIMIT = 4000;

type RoleText = { name?: string; description?: string; skill?: string; instructions?: string };

/** Every role starter this text matches, strongest role first. */
function startersForRole(text: RoleText): StarterTemplate[] {
  const scores = new Map<number, number>();
  for (const [field, weight] of roleFields) {
    const value = field === 'instructions' ? text.instructions?.slice(0, INSTRUCTION_LIMIT) : text[field];
    if (!value?.trim()) continue;
    const words = roleWords(value);
    roleStarters.forEach((entry, index) => {
      // One match per entry per field, so repeating a word does not add up.
      if (!entry.words.some(word => containsKeyword(words, word))) return;
      scores.set(index, (scores.get(index) ?? 0) + weight);
    });
  }
  return [...scores]
    .sort((first, second) => second[1] - first[1])
    .flatMap(([index]) => roleStarters[index].starters);
}

const roleTextOfWorker = (worker: Worker, skills: readonly Skill[]): RoleText => ({
  name: worker.name,
  description: worker.description,
  skill: skills.find(skill => skill.id === worker.skillId)?.name,
  instructions: worker.instructions,
});

export type StarterInput = {
  /** The worker whose chat is open, or the member roster when a team chat is open. */
  worker?: Worker;
  team?: Team;
  members?: readonly Worker[];
  skills?: readonly Skill[];
  /** Tasks of this chat only, so history comes from this worker or team and nowhere else. */
  tasks?: readonly Task[];
  /** Something is attached right now, so a starter that reads attachments would work. */
  hasSources?: boolean;
  limit?: number;
};

const DEFAULT_LIMIT = 4;

/**
 * The starters for one empty chat, most specific first: what this chat repeats, then the role of the worker (or of
 * the team's members), then the attachments, then a generic tail so the list is never empty. A starter that would
 * fail right now is never offered, so nothing here errors when it is clicked.
 */
export function suggestStarters(input: StarterInput): Starter[] {
  const { worker, team, members = [], skills = [], tasks = [], hasSources = false, limit = DEFAULT_LIMIT } = input;
  const candidates: StarterTemplate[] = [];
  if (team) {
    candidates.push(...teamStarters);
    candidates.push(...startersForRole({ name: team.name, instructions: team.instructions }));
    for (const member of members) candidates.push(...startersForRole(roleTextOfWorker(member, skills)));
  } else if (worker) {
    candidates.push(...startersForRole(roleTextOfWorker(worker, skills)));
  }
  candidates.push(...sourceStarters, ...genericStarters);

  const chosen: Starter[] = historyStarters(tasks);
  const taken = new Set(chosen.map(starter => starter.id));
  for (const candidate of candidates) {
    if (chosen.length >= limit) break;
    if (taken.has(candidate.id)) continue;
    if (candidate.needsSources && !hasSources) continue;
    taken.add(candidate.id);
    chosen.push({ id: candidate.id, icon: candidate.icon, label: candidate.label, prompt: candidate.prompt });
  }
  return chosen.slice(0, limit);
}
