import { ALL_LOOKS, STARTER_LOOKS, formatLook, parseLook, sameLook, starterPaletteSlot, type OrgletLook } from './orglet-look';
import { containsKeyword, roleWords } from './role-words';

/*
 * Which look and colour an orglet gets when nobody picked one. A look is a body and a pair of eyes (`orglet-look.ts`).
 * Pure, so the renderer's avatars and the `orglet` terminal command (through main) agree on the same default.
 * The renderer re-exports all of this from `renderer/components/mascotSuggest.ts`.
 *
 * Suggestions are local and instant: the worker's name, description, skill name and instructions are split into words
 * (Vietnamese without diacritics, and English), then matched against a small role lexicon. A smarter suggester (for
 * example a model call) can replace `rankLooks` later without changing the picker.
 */

/*
 * Role lexicon: each entry names its looks as `<body>-<eyes>` (the first fits best) and its keywords, written
 * lowercase without diacritics. A keyword of several words must appear as consecutive words. Words shorter than four
 * letters must match exactly ("pr", "qa", "lich"); longer final words also match as a prefix, so "analy" covers
 * "analyst" and "analysis". Vietnamese single syllables are ambiguous ("hop" is both meeting and contract), so use
 * two-syllable phrases.
 */
const lexicon: { looks: string[]; words: string[] }[] = [
  { looks: ['base-curious', 'soft-narrow'], words: ['research', 'nghien cuu', 'tim kiem', 'tra cuu', 'search', 'investigat', 'khao sat', 'survey', 'source', 'nguon tin', 'thu thap', 'collect', 'crawl', 'scrap', 'literature', 'tham khao', 'kiem chung', 'fact check', 'due diligence', 'dieu tra'] },
  { looks: ['wide-curious', 'soft-narrow'], words: ['data', 'du lieu', 'scor', 'chart', 'bieu do', 'phan tich', 'analy', 'metric', 'so lieu', 'bao cao', 'report', 'thong ke', 'statistic', 'dashboard', 'excel', 'spreadsheet', 'bang tinh', 'sql', 'insight', 'forecast', 'du bao', 'benchmark'] },
  { looks: ['round-delighted', 'soft-narrow'], words: ['review', 'duyet', 'kiem tra', 'check', 'audit', 'qa', 'test', 'danh gia', 'evaluat', 'kiem dinh', 'verif', 'xac minh', 'chat luong', 'quality', 'soat loi', 'proofread', 'validat', 'grader', 'cham diem', 'critic', 'phan bien', 'rubric'] },
  { looks: ['base-narrow', 'round-delighted'], words: ['secur', 'bao mat', 'risk', 'rui ro', 'complian', 'tuan thu', 'legal', 'phap ly', 'phap che', 'luat su', 'lawyer', 'privacy', 'rieng tu', 'an toan', 'gdpr', 'policy', 'fraud', 'gian lan'] },
  { looks: ['soft-happy', 'leaf-happy'], words: ['writ', 'viet bai', 'bien soan', 'soan thao', 'content', 'noi dung', 'copy', 'editor', 'bien tap', 'doc', 'docs', 'tai lieu', 'synthes', 'tong hop', 'summar', 'tom tat', 'translat', 'dich thuat', 'bien dich', 'blog', 'article', 'bai viet', 'proposal'] },
  { looks: ['leaf-happy', 'soft-happy'], words: ['note', 'ghi chu', 'bien ban', 'minutes', 'transcri', 'knowledge', 'tri thuc', 'wiki', 'archiv', 'luu tru'] },
  { looks: ['tail-top-delighted', 'soft-happy'], words: ['marketing', 'truyen thong', 'social', 'mang xa hoi', 'pr', 'quang cao', 'ads', 'advertis', 'campaign', 'chien dich', 'brand', 'thuong hieu', 'seo', 'facebook', 'tiktok', 'influencer', 'bao chi', 'press'] },
  { looks: ['tail-right-curious', 'tall-wink'], words: ['code', 'coding', 'dev', 'developer', 'engineer', 'ky su', 'ky thuat', 'lap trinh', 'program', 'api', 'frontend', 'backend', 'fullstack', 'software', 'phan mem', 'debug', 'bug', 'git', 'github', 'python', 'javascript', 'typescript', 'web', 'app', 'ung dung', 'architect', 'kien truc'] },
  { looks: ['tall-wink', 'tail-right-curious'], words: ['automat', 'tu dong', 'workflow', 'quy trinh', 'pipeline', 'ops', 'devops', 'van hanh', 'script', 'integrat', 'tich hop', 'deploy', 'trien khai', 'bot', 'cron', 'etl', 'sync', 'dong bo'] },
  { looks: ['wide-plain', 'wide-happy'], words: ['support', 'ho tro', 'cskh', 'customer', 'khach hang', 'helpdesk', 'cham soc', 'tu van', 'consult', 'call center', 'tong dai', 'ticket', 'hotline'] },
  { looks: ['wide-happy', 'leaf-plain'], words: ['hr', 'nhan su', 'recruit', 'tuyen dung', 'onboard', 'dao tao', 'train', 'coach', 'mentor', 'people', 'con nguoi', 'phuc loi', 'wellbeing', 'van hoa', 'culture', 'tam ly', 'suc khoe', 'health'] },
  { looks: ['tall-happy', 'tail-right-plain'], words: ['financ', 'tai chinh', 'ke toan', 'accountant', 'accounting', 'budget', 'ngan sach', 'cost', 'chi phi', 'invoice', 'hoa don', 'thue', 'tax', 'payroll', 'bang luong', 'tinh luong', 'pricing', 'bao gia', 'revenue', 'doanh thu', 'loi nhuan', 'profit', 'dau tu', 'invest', 'ngan hang', 'bank', 'thanh toan', 'payment', 'cong no'] },
  { looks: ['tail-right-plain', 'tall-plain'], words: ['sale', 'ban hang', 'kinh doanh', 'business', 'deal', 'hop dong', 'contract', 'doi tac', 'partner', 'procurement', 'mua hang', 'purchas', 'nha cung cap', 'vendor', 'supplier', 'crm'] },
  { looks: ['tall-plain', 'round-curious'], words: ['manag', 'quan ly', 'lead', 'truong nhom', 'truong phong', 'director', 'giam doc', 'ceo', 'cto', 'coo', 'pm', 'project', 'du an', 'plan', 'ke hoach', 'dieu phoi', 'coordinat', 'orchestrat', 'strategy', 'chien luoc', 'supervis', 'giam sat', 'founder', 'executive', 'dieu hanh'] },
  { looks: ['base-happy', 'soft-plain'], words: ['schedul', 'lich hop', 'lich hen', 'lich lam viec', 'lich trinh', 'xep lich', 'dat lich', 'calendar', 'meeting', 'cuoc hop', 'thu ky', 'secretar', 'assistant', 'tro ly', 'admin', 'hanh chinh', 'le tan', 'reception', 'booking', 'su kien', 'event'] },
  { looks: ['tail-right-happy', 'wide-plain'], words: ['mail', 'email', 'hop thu', 'gui thu', 'thu dien tu', 'inbox', 'outreach', 'lien he', 'contact', 'reply', 'tra loi', 'newsletter', 'thu moi'] },
  { looks: ['round-plain', 'leaf-delighted'], words: ['idea', 'y tuong', 'brainstorm', 'creativ', 'sang tao', 'design', 'thiet ke', 'innovat', 'doi moi', 'concept', 'ux', 'ui', 'prototyp'] },
  { looks: ['leaf-plain', 'tall-curious'], words: ['growth', 'tang truong', 'learn', 'hoc tap', 'hoc vien', 'student', 'sinh vien', 'intern', 'thuc tap', 'junior', 'giao duc', 'education', 'teacher', 'giao vien'] },
  { looks: ['round-curious', 'tall-plain'], words: ['goal', 'muc tieu', 'okr', 'kpi', 'target', 'uu tien', 'priorit', 'roadmap', 'lo trinh', 'milestone'] },
  { looks: ['tail-top-plain', 'base-curious'], words: ['monitor', 'theo doi', 'news', 'tin tuc', 'radar', 'iot', 'canh bao', 'alert', 'signal', 'tin hieu'] },
  { looks: ['leaf-delighted', 'round-happy'], words: ['fun', 'giai tri', 'entertain', 'game', 'tro choi', 'community', 'cong dong'] },
];

export type MascotHints = { name: string; description?: string; skill?: string; instructions?: string };
export type LookSuggestion = { look: OrgletLook; score: number };

// Name matters most; long instructions only nudge. Instructions are cut so a pasted document cannot dominate.
const fields = [['name', 4], ['description', 2.5], ['skill', 2], ['instructions', 1]] as const;
const INSTRUCTION_LIMIT = 4000;

/** A stable, non-negative number for a seed text, so the same id always picks the same look or colour. */
export function seedHash(text: string): number {
  let value = 0;
  for (const character of text) {
    value = (value * 31 + character.codePointAt(0)!) | 0;
  }
  return Math.abs(value);
}

const cache = new Map<string, LookSuggestion[]>();

/** Every matching look, best first. Empty when nothing matches. */
export function rankLooks(hints: MascotHints): LookSuggestion[] {
  const key = JSON.stringify([hints.name, hints.description, hints.skill, hints.instructions?.slice(0, INSTRUCTION_LIMIT)]);
  const cached = cache.get(key);
  if (cached) return cached;
  const scores = new Map<string, number>();
  for (const [field, weight] of fields) {
    const text = field === 'instructions' ? hints.instructions?.slice(0, INSTRUCTION_LIMIT) : hints[field];
    if (!text?.trim()) continue;
    const words = roleWords(text);
    for (const entry of lexicon) {
      // One match per entry per field, so repeating a word does not add up.
      if (!entry.words.some(word => containsKeyword(words, word))) continue;
      entry.looks.forEach((lookKey, index) => scores.set(lookKey, (scores.get(lookKey) ?? 0) + weight * (entry.looks.length - index)));
    }
  }
  const ranked = [...scores].map(([lookKey, score]) => ({ look: parseLook(lookKey)!, score })).sort((a, b) => b.score - a.score);
  if (cache.size > 300) cache.clear();
  cache.set(key, ranked);
  return ranked;
}

export const suggestLooks = (hints: MascotHints): OrgletLook[] => rankLooks(hints).map(item => item.look);

const fallbackSuggestions: OrgletLook[] = ['tall-plain', 'tail-right-plain', 'leaf-happy', 'base-happy', 'round-happy', 'base-plain', 'base-curious', 'round-delighted'].map(key => parseLook(key)!);
// A look another worker already shows keeps a share of its score, so the team gets different looks when a close
// alternative exists, without hiding the best fit.
const TAKEN_SHARE = 0.45;

/** What the "Gợi ý khác" button steps through: matches first (looks used by other workers pushed back), then office basics. */
export function suggestedLooks(hints: MascotHints, { limit = 7, taken = [] }: { limit?: number; taken?: readonly OrgletLook[] } = {}): OrgletLook[] {
  const isTaken = (look: OrgletLook) => taken.some(other => sameLook(other, look));
  const matches = rankLooks(hints).map(item => ({ look: item.look, score: item.score * (isTaken(item.look) ? TAKEN_SHARE : 1) })).sort((a, b) => b.score - a.score).map(item => item.look);
  const fill = [...fallbackSuggestions.filter(look => !isTaken(look)), ...fallbackSuggestions.filter(isTaken)];
  const unique = new Map([...matches, ...fill].map(look => [formatLook(look), look]));
  return [...unique.values()].slice(0, limit);
}

/**
 * The look an entity gets when nobody picked one: the best match, choosing by seed among equally good ones so similar
 * workers still differ; without a match, a seed-picked look from the starter pool.
 */
export function autoLook(seed: string, hints: MascotHints): OrgletLook {
  const ranked = rankLooks(hints);
  const best = ranked.filter(item => item.score === ranked[0].score).map(item => item.look);
  return best.length ? best[seedHash(seed) % best.length] : STARTER_LOOKS[seedHash(seed) % STARTER_LOOKS.length];
}

/** The look an orglet shows: the one stored in its `mascot` (an old name included), else the automatic one. */
export function shownLook(stored: string | undefined, seed: string, hints: MascotHints): OrgletLook {
  return parseLook(stored) ?? autoLook(seed, hints);
}

/**
 * A look for a new orglet that another orglet does not already show, in look or colour, when a close match exists
 * (COD-265). Orglets made together for similar roles (a writer and an editor) otherwise got the same best match and
 * the same colour. With nothing taken it is the plain automatic look. `shownColors` are the colours the other orglets
 * really show, a colour the person picked included; without it, each taken look counts with its own colour.
 */
export function distinctLook(hints: MascotHints, seed: string, taken: readonly OrgletLook[], shownColors?: readonly string[]): OrgletLook {
  if (!taken.length) return autoLook(seed, hints);
  const takenColors = new Set((shownColors ?? taken.map(lookColor)).map(color => color.toLowerCase()));
  const options = suggestedLooks(hints, { limit: ALL_LOOKS.length, taken });
  const isTaken = (look: OrgletLook) => taken.some(other => sameLook(other, look));
  const freshLookAndColor = options.find(look => !isTaken(look) && !takenColors.has(lookColor(look).toLowerCase()));
  const freshLook = options.find(look => !isTaken(look));
  return freshLookAndColor ?? freshLook ?? autoLook(seed, hints);
}

// Soft identity colours; the same seed always picks the same one when nothing better is known.
export const avatarPalette = ['#d97757', '#4f7fe0', '#3f9a68', '#a764c9', '#c9922e', '#d65c73', '#3597ab', '#7b818c'];

/**
 * A look's own colour, chosen to suit the role it stood for (money green, security slate, marketing coral). The looks
 * the old names covered keep the colour their name gave, so a saved orglet that never chose a colour does not change;
 * any other look takes a palette colour from its stored form.
 */
export function lookColor(look: OrgletLook): string {
  return avatarPalette[starterPaletteSlot(look) ?? seedHash(formatLook(look)) % avatarPalette.length];
}

/**
 * Three colours to offer first, best first: the colour of the look shown, then the colours of the next suggestions for
 * this worker, then the seed colour and the rest of the palette. The first is what "automatic" uses.
 */
export function suggestedColors(look: OrgletLook, seed: string, hints: MascotHints, count = 3) {
  const colors = [lookColor(look), ...suggestLooks(hints).map(lookColor), avatarPalette[seedHash(seed) % avatarPalette.length], ...avatarPalette];
  return [...new Set(colors)].slice(0, count);
}

/**
 * The look and colour a new orglet starts with when the person picks nothing (dogfood, 2026-09-26: two orglets made in
 * a row, a developer and a writer, both came out purple). The look is `distinctLook`; when every fitting look's
 * colour is already shown, the look stays and the colour moves to the first suggested or palette colour nobody shows.
 * `color` is left out when the look's own colour is free, so the orglet keeps following its look. `mascot` is the
 * stored `<body>-<eyes>` form.
 */
export function distinctAvatar(hints: MascotHints, seed: string, taken: readonly OrgletLook[], shownColors: readonly string[]): { mascot: string; color?: string } {
  const look = distinctLook(hints, seed, taken, shownColors);
  const mascot = formatLook(look);
  const used = new Set(shownColors.map(color => color.toLowerCase()));
  if (!used.has(lookColor(look).toLowerCase())) return { mascot };
  const candidates = suggestedColors(look, seed, hints, avatarPalette.length + 1);
  const free = candidates.find(color => !used.has(color.toLowerCase()));
  return free ? { mascot, color: free } : { mascot };
}

export type AvatarOwner = { id?: string; name: string; description?: string; avatar?: { mascot?: string; color?: string } };

/**
 * The colour an orglet shows, the same rule as a default-look `Avatar`: the colour the person picked, otherwise the
 * colour of its look, which is the picked one or the one suggested by its name and description, seeded by its id.
 */
export function defaultAvatarColor(owner: AvatarOwner): string {
  if (owner.avatar?.color) return owner.avatar.color;
  return lookColor(shownLook(owner.avatar?.mascot, owner.id ?? owner.name, { name: owner.name, description: owner.description }));
}
