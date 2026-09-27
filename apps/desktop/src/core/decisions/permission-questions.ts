import type { DecisionQuestions, DecisionResponse, DecisionState } from '../../shared/decisions';
import type { PermissionNeed } from '../../shared/permission-needs';

/**
 * The questions that read a message for the permissions it needs before it is sent (COD-305), and how their answers
 * become needs. Chosen on the tune half of `tests/fixtures/tacet/permission-needs.json` (48 English and Vietnamese
 * messages) and scored on the held-out half; the numbers are in docs/decisions.md.
 *
 * Two passes, because asking these together changed each one's answer: first which tool the request needs, on its own;
 * then whether it needs the internet and, if it touches files, what should be done with them. A six-way "what does this
 * need" choice, one yes/no per permission, and three-level scores all separated the labelled messages worse.
 */

/** The request is read as a field of a record, the shape Tacet was trained on, rather than as bare text. */
export function permissionNeedsState(text: string): DecisionState {
  return { request: text };
}

export const TOOL_QUESTION: DecisionQuestions = {
  tool: {
    type: 'choice',
    instructions: 'Which tool does the assistant need to handle this request?',
    criteria: {
      none: 'no tool: the answer comes from what it already knows',
      internet: 'the internet: current news, prices, weather or a web page',
      computer: "the user's computer: files, folders, code or commands",
      website: 'a website account: sign in, click, fill a form',
    },
  },
};

export const WEB_AND_FOLDER_QUESTIONS: DecisionQuestions = {
  web: {
    type: 'choice',
    instructions: 'Does this request need current information from the internet?',
    criteria: { yes: 'news, prices, weather, schedules or a web page', no: 'general knowledge or writing is enough' },
  },
  folder: {
    type: 'choice',
    instructions: "What should the assistant do with the user's files?",
    // Option names are part of what the model reads, so they stay the words it was tuned with; `FOLDER_LEVELS` maps them.
    criteria: { read: 'only read or look through them', edit: 'change, fix, rename or create files', run: 'run commands, tests, scripts or builds' },
  },
};

/** The folder answer's options as the working folder's levels. */
const FOLDER_LEVELS: Record<string, PermissionNeed> = { read: 'read', edit: 'write', run: 'execute' };

/** A short message and both questions fit in far less; cutting here keeps a pass near 50 ms on a desktop CPU. */
export const PERMISSION_NEEDS_MAX_LENGTH = 384;

/**
 * Each need is offered only above its threshold. The web is the average of the tool question's "internet" and the
 * yes/no, which ranked the labelled messages better than either alone. The thresholds sit just above every tuning
 * message that did not need the permission; the web's and the browser's one step higher still, since a held-out
 * message without the need sat within 0.01 of the tuning point. Below them the composer says nothing, as before Tacet.
 */
export const WEB_THRESHOLD = 0.55;
export const FOLDER_THRESHOLD = 0.2;
export const BROWSER_THRESHOLD = 0.55;

type ToolScores = { web: number; folder: number; browser: number };

function choiceProbabilities(response: DecisionResponse, question: string): Record<string, number> | undefined {
  const answer = response.answers[question];
  if (!answer || answer.type !== 'choice') return undefined;
  return answer.probabilities;
}

/** The first pass alone, or undefined when the answer is not the one asked for. */
export function toolScores(response: DecisionResponse): ToolScores | undefined {
  const tool = choiceProbabilities(response, 'tool');
  if (!tool) return undefined;
  return { web: tool.internet ?? 0, folder: tool.computer ?? 0, browser: tool.website ?? 0 };
}

/**
 * Whether the second pass can still matter: the web's average cannot reach its threshold from a first answer this low,
 * and the folder question only picks a level for a request already read as touching files.
 */
export function needsSecondPass(scores: ToolScores): boolean {
  const webCanClear = (scores.web + 1) / 2 >= WEB_THRESHOLD;
  return webCanClear || scores.folder >= FOLDER_THRESHOLD;
}

/** Every need that cleared its threshold, strongest first by how far above it the score landed. */
export function permissionNeedsFrom(scores: ToolScores, second: DecisionResponse | undefined): PermissionNeed[] {
  const found: { need: PermissionNeed; margin: number }[] = [];
  const web = second ? choiceProbabilities(second, 'web') : undefined;
  if (web) {
    const webScore = (scores.web + (web.yes ?? 0)) / 2;
    if (webScore >= WEB_THRESHOLD) found.push({ need: 'web', margin: webScore - WEB_THRESHOLD });
  }
  const folder = second?.answers.folder;
  const level = folder?.type === 'choice' ? FOLDER_LEVELS[folder.choice] : undefined;
  if (scores.folder >= FOLDER_THRESHOLD && level) found.push({ need: level, margin: scores.folder - FOLDER_THRESHOLD });
  if (scores.browser >= BROWSER_THRESHOLD) found.push({ need: 'browser', margin: scores.browser - BROWSER_THRESHOLD });
  return found.sort((left, right) => right.margin - left.margin).map(item => item.need);
}
