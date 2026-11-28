import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMenuModel, formatMenuGroup } from '../apps/agent-usage/menu-model.mjs';

const window = (short, remaining, level, resetsAt = null, state = 'live') => ({ short, remaining, level, resetsAt, state });
const rows = [
  { provider: 'claude', label: 'Claude Code', login: 'you@example.test',
    windows: [window('5h', 82.9, 'healthy', 1800), window('7d', 96, 'healthy', null, 'aging')] },
  { provider: 'codex', label: 'OpenAI Codex · Work', accountId: 'work',
    windows: [window('5h', 0, 'critical')] },
  { provider: 'agy', label: 'Antigravity · Gemini', windows: [window('5h', null, 'unknown')] },
];

test('[TC-AGU-56][FE-UT] renders grouped menu text and gives active providers precedence over exhausted ones', () => {
  const model = buildMenuModel(rows, [{ provider: 'claude' }, { provider: 'agy' }]);
  assert.deepEqual(model.status.map(({ provider, amount, dimmed }) => [provider, amount, dimmed]), [
    ['claude', '82%', false], ['agy', '—', false],
  ]);
  assert.deepEqual(formatMenuGroup(model.groups[0], time => new Date(time * 1000).toISOString().slice(11, 16)), [
    'Claude Code — you@example.test', '  5h · 82% remaining · Resets 00:30',
    '  7d · 96% remaining · Reset time unavailable · Stale',
  ]);
  assert.equal(formatMenuGroup(model.groups[1])[0], 'OpenAI Codex · Work');
});

test('[TC-AGU-57][FE-UT] uses a dimmed lowest provider when idle and the lowest quota across named accounts', () => {
  const active = buildMenuModel([...rows, { provider: 'claude', label: 'Claude Code · Other',
    windows: [window('7d', 63, 'watch')] }], [{ provider: 'claude' }]);
  assert.equal(active.status[0].amount, '63%');
  assert.deepEqual(buildMenuModel(rows, []).status.map(({ provider, amount, dimmed }) => [provider, amount, dimmed]),
    [['codex', '0%', true]]);
  assert.deepEqual(buildMenuModel([rows[2]], []).status, []);
});
