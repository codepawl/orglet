import { MarketCatalog, type MarketListing } from './market';

const researcher = {
  key: 'researcher', skillKey: 'research', name: 'Research friend',
  description: 'Find evidence, separate facts from guesses, and explain what matters.',
  avatar: { emoji: '🔎' }, provider: 'openai',
  instructions: 'Research the question with the sources the user provides or explicitly permits. Separate evidence from inference. Cite the source for each material claim. Say plainly when evidence is missing. Never ask for credentials or send private information to another service.',
};
const reviewer = {
  key: 'reviewer', skillKey: 'research', name: 'Review friend',
  description: 'Check an answer against its evidence and explain remaining uncertainty.',
  avatar: { emoji: '📝' }, provider: 'anthropic',
  instructions: 'Review the supplied answer and evidence. Identify unsupported conclusions, missing context, and contradictions. Suggest concrete corrections. Do not claim you ran checks or consulted sources unless you did. Never request credentials.',
};
const researchSkill = { key: 'research', name: 'Evidence notes', content: 'Keep a short record of the question, sources, evidence, uncertainties, and answer. Quote only what is necessary. Distinguish a source statement from your own inference.' };
const writer = {
  key: 'writer', skillKey: 'drafting', name: 'Writing friend',
  description: 'Turn checked notes into a clear draft in the voice you ask for.',
  avatar: { emoji: '✍️' }, provider: 'anthropic',
  instructions: 'Write from the notes and evidence the user and the other friends provide. Keep every claim to what the notes support. Say what you left out and why. Ask for the audience and the length when they are missing. Never request credentials.',
};
const draftingSkill = { key: 'drafting', name: 'Draft notes', content: 'Keep the brief, the audience, the outline and the open questions together. Mark every sentence that still needs a source.' };
const { key: _workerKey, skillKey: _skillKey, ...worker } = researcher;
const { key: _researchKey, ...skill } = researchSkill;

/** The same text-only seed is served by the Worker and carried by an offline desktop install. */
export const MARKET_SEED_BODIES: Record<string, string> = {
  'research-friend:1': JSON.stringify({ format: 'orglet-worker-template', version: 1, worker, skill }),
  'research-review:1': JSON.stringify({
    format: 'orglet-team-template', version: 1,
    team: { name: 'Research and review', instructions: 'Research the question, then have the reviewer check the evidence. Return one clear answer with sources and uncertainties.', workflow: 'sequential', monthlyBudgetMicros: 5_000_000, memberKeys: ['researcher', 'reviewer'], synthesizerKey: 'reviewer' },
    workers: [researcher, reviewer], skills: [researchSkill],
  }),
  // A space (docs/spaces-design.md): three friends, two categories, and channels that take all of them or some.
  'launch-space:1': JSON.stringify({
    format: 'orglet-space-template', version: 1,
    space: {
      name: 'Launch',
      categories: [{ key: 'research', name: 'Research' }, { key: 'writing', name: 'Writing' }],
      channels: [
        { name: 'general', topic: 'Plan the launch and decide what happens next' },
        { name: 'sources', topic: 'Find and check the evidence', categoryKey: 'research', memberKeys: ['researcher', 'reviewer'] },
        { name: 'drafts', topic: 'Write and review the copy', categoryKey: 'writing', memberKeys: ['writer', 'reviewer'] },
      ],
    },
    workers: [researcher, reviewer, writer], skills: [researchSkill, draftingSkill],
  }),
};
const metadata: Omit<MarketListing, 'sha256'>[] = [
  { listingId: 'research-friend', version: 1, kind: 'orglet', name: 'Research friend', summary: 'A friend who finds evidence and explains what is known, uncertain, or missing.', tags: ['research', 'evidence'], language: 'en', author: 'CodePawl', license: 'CC-BY-4.0', changelog: 'First curated version.' },
  { listingId: 'research-review', version: 1, kind: 'crew', name: 'Research and review', summary: 'Two friends research a question, review the evidence, and bring back one answer.', tags: ['research', 'review'], language: 'en', author: 'CodePawl', license: 'CC-BY-4.0', changelog: 'First curated version.' },
  { listingId: 'launch-space', version: 1, kind: 'space', name: 'Launch space', summary: 'A space for a launch: three friends, with channels for the plan, the sources and the drafts.', tags: ['launch', 'research', 'writing'], language: 'en', author: 'CodePawl', license: 'CC-BY-4.0', changelog: 'First version.' },
];
export async function seedCatalog() {
  const listings = await Promise.all(metadata.map(async listing => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(MARKET_SEED_BODIES[`${listing.listingId}:${listing.version}`]));
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { ...listing, sha256 };
  }));
  return MarketCatalog.parse({ listings });
}
