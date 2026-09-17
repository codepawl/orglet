import type { MascotId } from './mascots';

/*
 * Mascot categories and suggestions. Suggestions are local and instant: the worker's name, description, skill name and
 * instructions are split into words (Vietnamese without diacritics, and English), then matched against a small role
 * lexicon. A smarter suggester (for example a model call) can replace `rankMascots` later without changing the picker.
 */
export const mascotCategoryLabels = {
  basic: 'Cơ bản',
  office: 'Công sở',
  research: 'Nghiên cứu & phân tích',
  content: 'Nội dung & truyền thông',
  quality: 'Kiểm tra & bảo mật',
  tech: 'Kỹ thuật',
  support: 'Hỗ trợ & con người',
};
export type MascotCategory = keyof typeof mascotCategoryLabels;

export const mascotCategoryIds: Record<MascotCategory, MascotId[]> = {
  basic: ['classic', 'happy', 'curious', 'wink', 'delighted', 'cool', 'sleepy'],
  office: ['tie', 'bowtie', 'briefcase', 'calendar', 'mail', 'finance'],
  research: ['search', 'chart', 'focused', 'target', 'idea'],
  content: ['writer', 'notes', 'megaphone'],
  quality: ['checker', 'guard'],
  tech: ['coder', 'automation', 'antenna'],
  support: ['headset', 'care', 'sprout'],
};

/*
 * Role lexicon: each entry names its mascots (the first fits best) and its keywords, written lowercase without
 * diacritics. A keyword of several words must appear as consecutive words. Words shorter than four letters must match
 * exactly ("pr", "qa", "lich"); longer final words also match as a prefix, so "analy" covers "analyst" and "analysis".
 * Vietnamese single syllables are ambiguous ("hop" is both meeting and contract), so use two-syllable phrases.
 */
const lexicon: { ids: MascotId[]; words: string[] }[] = [
  { ids: ['search', 'focused'], words: ['research', 'nghien cuu', 'tim kiem', 'tra cuu', 'search', 'investigat', 'khao sat', 'survey', 'source', 'nguon tin', 'thu thap', 'collect', 'crawl', 'scrap', 'literature', 'tham khao', 'kiem chung', 'fact check', 'due diligence', 'dieu tra'] },
  { ids: ['chart', 'focused'], words: ['data', 'du lieu', 'scor', 'chart', 'bieu do', 'phan tich', 'analy', 'metric', 'so lieu', 'bao cao', 'report', 'thong ke', 'statistic', 'dashboard', 'excel', 'spreadsheet', 'bang tinh', 'sql', 'insight', 'forecast', 'du bao', 'benchmark'] },
  { ids: ['checker', 'focused'], words: ['review', 'duyet', 'kiem tra', 'check', 'audit', 'qa', 'test', 'danh gia', 'evaluat', 'kiem dinh', 'verif', 'xac minh', 'chat luong', 'quality', 'soat loi', 'proofread', 'validat', 'grader', 'cham diem', 'critic', 'phan bien', 'rubric'] },
  { ids: ['guard', 'checker'], words: ['secur', 'bao mat', 'risk', 'rui ro', 'complian', 'tuan thu', 'legal', 'phap ly', 'phap che', 'luat su', 'lawyer', 'privacy', 'rieng tu', 'an toan', 'gdpr', 'policy', 'fraud', 'gian lan'] },
  { ids: ['writer', 'notes'], words: ['writ', 'viet bai', 'bien soan', 'soan thao', 'content', 'noi dung', 'copy', 'editor', 'bien tap', 'doc', 'docs', 'tai lieu', 'synthes', 'tong hop', 'summar', 'tom tat', 'translat', 'dich thuat', 'bien dich', 'blog', 'article', 'bai viet', 'proposal'] },
  { ids: ['notes', 'writer'], words: ['note', 'ghi chu', 'bien ban', 'minutes', 'transcri', 'knowledge', 'tri thuc', 'wiki', 'archiv', 'luu tru'] },
  { ids: ['megaphone', 'writer'], words: ['marketing', 'truyen thong', 'social', 'mang xa hoi', 'pr', 'quang cao', 'ads', 'advertis', 'campaign', 'chien dich', 'brand', 'thuong hieu', 'seo', 'facebook', 'tiktok', 'influencer', 'bao chi', 'press'] },
  { ids: ['coder', 'automation'], words: ['code', 'coding', 'dev', 'developer', 'engineer', 'ky su', 'ky thuat', 'lap trinh', 'program', 'api', 'frontend', 'backend', 'fullstack', 'software', 'phan mem', 'debug', 'bug', 'git', 'github', 'python', 'javascript', 'typescript', 'web', 'app', 'ung dung', 'architect', 'kien truc'] },
  { ids: ['automation', 'coder'], words: ['automat', 'tu dong', 'workflow', 'quy trinh', 'pipeline', 'ops', 'devops', 'van hanh', 'script', 'integrat', 'tich hop', 'deploy', 'trien khai', 'bot', 'cron', 'etl', 'sync', 'dong bo'] },
  { ids: ['headset', 'care'], words: ['support', 'ho tro', 'cskh', 'customer', 'khach hang', 'helpdesk', 'cham soc', 'tu van', 'consult', 'call center', 'tong dai', 'ticket', 'hotline'] },
  { ids: ['care', 'sprout'], words: ['hr', 'nhan su', 'recruit', 'tuyen dung', 'onboard', 'dao tao', 'train', 'coach', 'mentor', 'people', 'con nguoi', 'phuc loi', 'wellbeing', 'van hoa', 'culture', 'tam ly', 'suc khoe', 'health'] },
  { ids: ['finance', 'briefcase'], words: ['financ', 'tai chinh', 'ke toan', 'accountant', 'accounting', 'budget', 'ngan sach', 'cost', 'chi phi', 'invoice', 'hoa don', 'thue', 'tax', 'payroll', 'bang luong', 'tinh luong', 'pricing', 'bao gia', 'revenue', 'doanh thu', 'loi nhuan', 'profit', 'dau tu', 'invest', 'ngan hang', 'bank', 'thanh toan', 'payment', 'cong no'] },
  { ids: ['briefcase', 'tie'], words: ['sale', 'ban hang', 'kinh doanh', 'business', 'deal', 'hop dong', 'contract', 'doi tac', 'partner', 'procurement', 'mua hang', 'purchas', 'nha cung cap', 'vendor', 'supplier', 'crm'] },
  { ids: ['tie', 'target'], words: ['manag', 'quan ly', 'lead', 'truong nhom', 'truong phong', 'director', 'giam doc', 'ceo', 'cto', 'coo', 'pm', 'project', 'du an', 'plan', 'ke hoach', 'dieu phoi', 'coordinat', 'orchestrat', 'strategy', 'chien luoc', 'supervis', 'giam sat', 'founder', 'executive', 'dieu hanh'] },
  { ids: ['calendar', 'bowtie'], words: ['schedul', 'lich hop', 'lich hen', 'lich lam viec', 'lich trinh', 'xep lich', 'dat lich', 'calendar', 'meeting', 'cuoc hop', 'thu ky', 'secretar', 'assistant', 'tro ly', 'admin', 'hanh chinh', 'le tan', 'reception', 'booking', 'su kien', 'event'] },
  { ids: ['mail', 'headset'], words: ['mail', 'email', 'hop thu', 'gui thu', 'thu dien tu', 'inbox', 'outreach', 'lien he', 'contact', 'reply', 'tra loi', 'newsletter', 'thu moi'] },
  { ids: ['idea', 'delighted'], words: ['idea', 'y tuong', 'brainstorm', 'creativ', 'sang tao', 'design', 'thiet ke', 'innovat', 'doi moi', 'concept', 'ux', 'ui', 'prototyp'] },
  { ids: ['sprout', 'curious'], words: ['growth', 'tang truong', 'learn', 'hoc tap', 'hoc vien', 'student', 'sinh vien', 'intern', 'thuc tap', 'junior', 'giao duc', 'education', 'teacher', 'giao vien'] },
  { ids: ['target', 'tie'], words: ['goal', 'muc tieu', 'okr', 'kpi', 'target', 'uu tien', 'priorit', 'roadmap', 'lo trinh', 'milestone'] },
  { ids: ['antenna', 'search'], words: ['monitor', 'theo doi', 'news', 'tin tuc', 'radar', 'iot', 'canh bao', 'alert', 'signal', 'tin hieu'] },
  { ids: ['delighted', 'happy'], words: ['fun', 'giai tri', 'entertain', 'game', 'tro choi', 'community', 'cong dong'] },
];

export type MascotHints = { name: string; description?: string; skill?: string; instructions?: string };
export type MascotSuggestion = { id: MascotId; score: number };

// Name matters most; long instructions only nudge. Instructions are cut so a pasted document cannot dominate.
const fields = [['name', 4], ['description', 2.5], ['skill', 2], ['instructions', 1]] as const;
const INSTRUCTION_LIMIT = 4000;

export const normalizeHint = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase();
export const seedHash = (text: string) => { let value = 0; for (const character of text) value = (value * 31 + character.codePointAt(0)!) | 0; return Math.abs(value); };

const tokenize = (text: string) => ({ normal: (text.match(/[\p{L}\p{N}]+/gu) ?? []).map(normalizeHint) });
const keywordParts = new Map(lexicon.flatMap(entry => entry.words).map(word => [word, word.split(' ')]));

/** Whether `text` contains `keyword`. */
function findKeyword(tokens: ReturnType<typeof tokenize>, keyword: string) {
  const parts = keywordParts.get(keyword)!;
  for (let start = 0; start + parts.length <= tokens.normal.length; start++) {
    const matches = parts.every((part, index) => {
      const token = tokens.normal[start + index];
      return index === parts.length - 1 && part.length >= 4 ? token.startsWith(part) : token === part;
    });
    if (matches) return true;
  }
  return false;
}

const cache = new Map<string, MascotSuggestion[]>();

/** Every matching mascot, best first. Empty when nothing matches. */
export function rankMascots(hints: MascotHints): MascotSuggestion[] {
  const key = JSON.stringify([hints.name, hints.description, hints.skill, hints.instructions?.slice(0, INSTRUCTION_LIMIT)]);
  const cached = cache.get(key);
  if (cached) return cached;
  const scores = new Map<MascotId, number>();
  for (const [field, weight] of fields) {
    const text = field === 'instructions' ? hints.instructions?.slice(0, INSTRUCTION_LIMIT) : hints[field];
    if (!text?.trim()) continue;
    const tokens = tokenize(text);
    for (const entry of lexicon) {
      // One match per entry per field, so repeating a word does not add up.
      if (!entry.words.some(word => findKeyword(tokens, word))) continue;
      entry.ids.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + weight * (entry.ids.length - index)));
    }
  }
  const ranked = [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
  if (cache.size > 300) cache.clear();
  cache.set(key, ranked);
  return ranked;
}

export const suggestMascots = (hints: MascotHints): MascotId[] => rankMascots(hints).map(item => item.id);

const fallbackSuggestions: MascotId[] = ['tie', 'briefcase', 'notes', 'calendar', 'happy', 'classic', 'search', 'checker'];
// A mascot another worker already shows keeps a share of its score, so the team gets different faces when a close
// alternative exists, without hiding the best fit.
const TAKEN_SHARE = 0.45;

/** What the Gợi ý button steps through: matches first (mascots used by other workers pushed back), then office basics. */
export function suggestedMascots(hints: MascotHints, { limit = 7, taken = [] }: { limit?: number; taken?: readonly string[] } = {}) {
  const isTaken = (id: MascotId) => taken.includes(id);
  const matches = rankMascots(hints).map(item => ({ id: item.id, score: item.score * (isTaken(item.id) ? TAKEN_SHARE : 1) })).sort((a, b) => b.score - a.score).map(item => item.id);
  const fill = [...fallbackSuggestions.filter(id => !isTaken(id)), ...fallbackSuggestions.filter(isTaken)];
  return [...new Set([...matches, ...fill])].slice(0, limit);
}

/**
 * The face an entity gets when nobody picked one: the best match, choosing by seed among equally good ones so similar
 * workers still differ; without a match, a seed-picked mascot from `ids`.
 */
export function autoMascot(ids: readonly MascotId[], seed: string, hints: MascotHints): MascotId {
  const ranked = rankMascots(hints);
  const best = ranked.filter(item => item.score === ranked[0].score).map(item => item.id);
  return best.length ? best[seedHash(seed) % best.length] : ids[seedHash(seed) % ids.length];
}

// Soft identity colours; the same seed always picks the same one when nothing better is known.
export const avatarPalette = ['#d97757', '#4f7fe0', '#3f9a68', '#a764c9', '#c9922e', '#d65c73', '#3597ab', '#7b818c'];
const [coral, blue, green, purple, amber, rose, teal, slate] = avatarPalette;

// Each mascot's own colour, chosen to suit the role it stands for (money green, security slate, marketing coral).
export const mascotColors: Record<MascotId, string> = {
  classic: blue, happy: amber, curious: teal, wink: purple, delighted: rose, cool: slate, sleepy: purple,
  tie: blue, bowtie: rose, briefcase: amber, calendar: coral, mail: blue, finance: green,
  search: blue, chart: teal, focused: blue, target: coral, idea: amber,
  writer: purple, notes: amber, megaphone: coral,
  checker: green, guard: slate,
  coder: purple, automation: amber, antenna: teal,
  headset: teal, care: rose, sprout: green,
};

/**
 * Three colours to offer first, best first: the colour of the face shown, then the colours of the next suggestions for
 * this worker, then the seed colour and the rest of the palette. The first is what "automatic" uses.
 */
export function suggestedColors(face: MascotId, seed: string, hints: MascotHints, count = 3) {
  const colors = [mascotColors[face], ...suggestMascots(hints).map(id => mascotColors[id]), avatarPalette[seedHash(seed) % avatarPalette.length], ...avatarPalette];
  return [...new Set(colors)].slice(0, count);
}
