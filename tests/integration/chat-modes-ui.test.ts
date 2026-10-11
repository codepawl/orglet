import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { approvalModes } from '../../apps/desktop/src/shared/approval-mode';
import { ChatModePicker } from '../../apps/desktop/src/renderer/components/ApprovalModePicker';
import {
  approvedByLabel, decisionModelMissing, modeNames, modeRowNote, needsBypassConfirmation,
} from '../../apps/desktop/src/renderer/approvalModeText';
import { entriesOfEvents, traceSummary } from '../../apps/desktop/src/renderer/turnTrace';
import { withCapability, type ToolCapability } from '../../apps/desktop/src/shared/tool-policy';

/** The Mode menu's pure choices: which note a row shows, when Bypass asks, and who approved a step. */
describe('the Mode menu text', () => {
  it('names the five modes of the Claude Code menu in order', () => {
    expect(approvalModes.map(mode => modeNames[mode])).toEqual(['Auto', 'Manual', 'Accept edits', 'Plan', 'Bypass permissions']);
  });

  it('gives each row one short note, a folder need or a lock in its place', () => {
    expect(modeRowNote('manual', {})).toBe('Asks before changes');
    expect(modeRowNote('acceptEdits', {})).toBe('Accepts file edits');
    expect(modeRowNote('plan', {})).toBe('Reads and plans only');
    expect(modeRowNote('bypass', {})).toBe('Asks nothing');
    expect(modeRowNote('manual', { folderNeed: 'pick' })).toBe('Needs a folder');
    expect(modeRowNote('acceptEdits', { folderNeed: 'edit' })).toBe('Needs edit access');
    expect(modeRowNote('manual', { locked: 'Locked here.', folderNeed: 'pick' })).toBe('Locked here.');
  });

  it('says Auto still asks when no decision model is connected', () => {
    expect(modeRowNote('auto', {})).toBe('A light model approves');
    expect(modeRowNote('auto', { decisionModelMissing: true })).toBe('No decision model yet');
    expect(modeRowNote('manual', { decisionModelMissing: true })).toBe('Asks before changes');
    expect(decisionModelMissing(undefined)).toBe(false);
    expect(decisionModelMissing({ entries: [], chosen: false })).toBe(true);
    expect(decisionModelMissing({ entries: [{ connection: 'openai', model: 'gpt-6-luna' }], chosen: false })).toBe(false);
  });

  it('asks before Bypass is turned on, and only then', () => {
    expect(needsBypassConfirmation('bypass', 'manual')).toBe(true);
    expect(needsBypassConfirmation('bypass', 'auto')).toBe(true);
    expect(needsBypassConfirmation('bypass', 'bypass')).toBe(false);
    expect(needsBypassConfirmation('manual', 'bypass')).toBe(false);
    expect(needsBypassConfirmation('plan', 'bypass')).toBe(false);
  });

  it('labels a step Auto or Bypass allowed and no other', () => {
    expect(approvedByLabel('auto')).toBe('Auto');
    expect(approvedByLabel('bypass')).toBe('Bypass permissions');
    expect(approvedByLabel('person')).toBeUndefined();
    expect(approvedByLabel(null)).toBeUndefined();
  });
});

describe('the Mode button and menu', () => {
  const picker = (capabilities: ToolCapability[]) => renderToStaticMarkup(createElement(ChatModePicker, {
    planKey: 'task:ui', capabilities, level: 'write', appliesAtOnce: false, sideThread: false, onChange: () => {},
  }));

  it('wears a warning mark only while Bypass is on', () => {
    const bypass = picker(['source.read', 'workspace.apply', 'approval.bypass']);
    expect(bypass).toContain('composer-mode-bypass');
    expect(bypass).toContain('aria-label="Mode: Bypass permissions"');
    expect(picker(['source.read', 'workspace.apply', 'approval.auto'])).not.toContain('composer-mode-bypass');
  });

  it('turns Auto and Bypass off when review is turned back on from Details', () => {
    const inBypass: ToolCapability[] = ['source.read', 'workspace.apply', 'approval.bypass'];
    const reviewed = withCapability(inBypass, 'workspace.apply', false);
    expect(picker(reviewed)).toContain('aria-label="Mode: Manual"');
  });
});

describe('the trace for a call Auto or Bypass allowed', () => {
  it('reads as a note row with its own kind, not as unknown text', () => {
    const messages = [
      'Chế độ Tự động đã cho phép công cụ MCP: search · GitHub',
      'Chế độ Bỏ qua quyền đã cho phép công cụ MCP: search · GitHub',
      'Đã dùng công cụ MCP: search · GitHub',
    ];
    const events = messages.map((message, index) => ({ id: 'event-' + index, runId: 'run', message, createdAt: '2026-10-11T00:00:00.000Z' }));
    const entries = entriesOfEvents(events, 'run');
    expect(entries.map(entry => entry.kind)).toEqual(['mcp_approved', 'mcp_approved', 'mcp']);
    expect(traceSummary(entries)).toBe('Used 1 MCP tool');
  });
});
