import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Decisions } from '../../apps/desktop/src/core/decisions/service';
import { TACET_FILES } from '../../apps/desktop/src/core/decisions/manifest';
import { TacetEngine } from '../../apps/desktop/src/core/decisions/engine';
import { PermissionSuggestions } from '../../apps/desktop/src/core/orchestration/permission-suggestions';
import { ROUTING_MAX_LENGTH, routedOrglet, routingQuestion, type RoutableOrglet } from '../../apps/desktop/src/core/decisions/group-routing';
import { isFolderNeed, type PermissionNeed } from '../../apps/desktop/src/shared/permission-needs';

/**
 * The permission hints and the group-chat routing (COD-305) on their labelled sets with the real model. It runs only
 * when `ORGLET_TACET_DIR` names a folder holding the downloaded model and tokenizer at their pinned sizes, and is skipped
 * otherwise, so CI and a checkout without the 320 MB download stay as they are. The bars are what the shipped
 * thresholds scored (docs/decisions.md), less a little room for another CPU's rounding.
 */
const folder = process.env.ORGLET_TACET_DIR;
const available = Boolean(folder) && [TACET_FILES.model, TACET_FILES.tokenizer].every(file => {
  const path = join(folder!, file.name);
  return existsSync(path) && statSync(path).size === file.bytes;
});

type NeedCase = { need: 'none' | 'web' | 'read' | 'edit' | 'run' | 'browser'; text: string };
type RoutingCase = { group: string; expect: string; text: string };
const fixtures = join(__dirname, '..', 'fixtures', 'tacet');
const expectedNeed: Record<NeedCase['need'], PermissionNeed | undefined> = { none: undefined, web: 'web', read: 'read', edit: 'write', run: 'execute', browser: 'browser' };

function inProcess(): Decisions {
  return new Decisions({
    directory: folder,
    runtime: async files => {
      const engine = await TacetEngine.load({ model: files.model.path, tokenizer: files.tokenizer.path });
      return { decide: (state, questions, maxLength) => engine.decide(state, questions, maxLength), close: () => engine.close() };
    },
  });
}

describe.skipIf(!available)('Tacet on the labelled sets (COD-305, real model)', () => {
  it('never hints on a message that needs nothing, and offers the right control for most that need one', async () => {
    const decisions = inProcess();
    const suggestions = new PermissionSuggestions(() => decisions, 60_000);
    const cases = (JSON.parse(readFileSync(join(fixtures, 'permission-needs.json'), 'utf8')) as { cases: NeedCase[] }).cases;
    let falseHints = 0;
    let rightControl = 0;
    let needing = 0;
    for (const item of cases) {
      const offered = (await suggestions.suggest(item.text))?.needs[0];
      const expected = expectedNeed[item.need];
      if (!expected) {
        if (offered) falseHints++;
        continue;
      }
      needing++;
      if (offered && (offered === expected || (isFolderNeed(offered) && isFolderNeed(expected)))) rightControl++;
    }
    await decisions.shutdown();
    expect(falseHints).toBe(0);
    expect(rightControl / needing).toBeGreaterThanOrEqual(0.65);
  }, 180_000);

  it('never routes a message to the wrong orglet or away from a group it was meant for', async () => {
    const decisions = inProcess();
    const routing = JSON.parse(readFileSync(join(fixtures, 'group-routing.json'), 'utf8')) as { groups: Record<string, Omit<RoutableOrglet, 'id'>[]>; cases: RoutingCase[] };
    let wrong = 0;
    let routedRight = 0;
    for (const item of routing.cases) {
      const orglets = routing.groups[item.group].map((orglet, index) => ({ ...orglet, id: `${item.group}-${index}` }));
      const pick = routedOrglet(await decisions.decide(item.text, routingQuestion(orglets), ROUTING_MAX_LENGTH), orglets);
      if (!pick) continue;
      if (pick.orglet.name === item.expect) routedRight++;
      else wrong++;
    }
    await decisions.shutdown();
    expect(wrong).toBe(0);
    expect(routedRight).toBeGreaterThanOrEqual(6);
  }, 180_000);
});
