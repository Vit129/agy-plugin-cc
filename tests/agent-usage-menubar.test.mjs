import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const swift = spawnSync('swiftc', ['--version']);
const now = Date.UTC(2026, 10, 28, 12) / 1000;
const hour = 3600;
const window = (short, remaining, resetsAt) => ({ short, remaining, resetsAt, state: 'live' });
const claude = { provider: 'claude', windows: [window('5h', 93, now + 2 * hour), window('7d', 33, now + 48 * hour)] };
const copilot = { provider: 'copilot', windows: [window('monthly', 21, now + 72 * hour)] };

describe('Agent Usage status title', { skip: swift.error?.code === 'ENOENT' && 'swiftc unavailable' }, () => {
  let directory;
  let executable;

  before(() => {
    const scratch = join(root, '.tmp');
    mkdirSync(scratch, { recursive: true });
    directory = mkdtempSync(join(scratch, 'status-title-test-'));
    executable = join(directory, 'status-title');
    execFileSync('swiftc', [
      '-module-cache-path', join(directory, 'modules'),
      'apps/agent-usage/menubar/QuotaPace.swift',
      'apps/agent-usage/menubar/StatusTitle.swift',
      'tests/fixtures/StatusTitleMain.swift',
      '-o', executable,
    ], { cwd: root, stdio: 'pipe' });
  });

  after(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  function model(input) {
    return JSON.parse(execFileSync(executable, {
      input: JSON.stringify({ rows: [], active: [], now, width: 360, timeZone: 'Asia/Bangkok', ...input }),
      encoding: 'utf8',
    }));
  }

  test('[TC-AGU-30][FE-UT] formats the two windows for each active provider in activity order', () => {
    const { titles, compact } = model({ rows: [claude, copilot], active: ['copilot', 'claude'] });
    assert.equal(compact, false);
    assert.deepEqual(titles.map(title => title.provider), ['copilot', 'claude']);
    assert.equal(titles[0].session, undefined);
    assert.equal(titles[0].longest.reset, '1 Dec 19:00');
    assert.equal(titles[0].longest.label, 'M');
    assert.equal(titles[1].session.reset, '21:00');
    assert.equal(titles[1].session.label, '5h');
    assert.equal(titles[1].session.amount, '93%');
    assert.equal(titles[1].longest.reset, '30 Nov 19:00');
    assert.equal(titles[1].longest.label, 'W');
  });

  test('[TC-AGU-31][FE-UT] keeps missing reset percentages and selects the lowest account quota per window', () => {
    const { titles } = model({
      rows: [claude, { provider: 'claude', windows: [window('5h', 92.8, null)] }], active: ['claude'],
    });
    assert.equal(titles[0].session.amount, '92%');
    assert.equal(titles[0].session.reset, undefined);
    assert.equal(titles[0].session.tone, 'unknown');
    assert.equal(titles[0].longest.amount, '33%');
  });

  test('[TC-AGU-32][FE-UT] shows only the lowest provider when idle', () => {
    assert.deepEqual(model({ rows: [claude, copilot] }).titles.map(title => title.provider), ['copilot']);
    assert.deepEqual(model({ rows: [{ provider: 'claude', windows: [window('5h', null, null)] }] }).titles, []);
  });

  test('[TC-AGU-33][FE-UT] compacts all providers before hiding the least recent', () => {
    const input = { rows: [claude, copilot], active: ['claude', 'copilot'] };
    const compact = model({ ...input, width: 100 });
    assert.equal(compact.compact, true);
    assert.equal(compact.titles.length, 2);
    const hidden = model({ ...input, width: 40 });
    assert.equal(hidden.compact, true);
    assert.deepEqual(hidden.titles.map(title => title.provider), ['claude']);
  });

  test('[TC-AGU-34][FE-UT] puts an active provider with missing data in the title', () => {
    const { titles } = model({ active: ['codex'] });
    assert.equal(titles[0].provider, 'codex');
    assert.equal(titles[0].session, undefined);
  });

  test('[TC-AGU-35][BE-UT] computes expected remaining and reserve for ahead and close windows', () => {
    const ahead = model({ window: window('5h', 70, now + 2.5 * hour) });
    assert.equal(ahead.expectedRemaining, 0.5);
    assert.ok(Math.abs(ahead.reserve - 0.2) < 1e-10);
    assert.equal(ahead.tone, 'onPace');
    assert.equal(ahead.lastsUntilReset, true);
    assert.equal(model({ window: window('5h', 52, now + 2.5 * hour) }).tone, 'close');
  });

  test('[TC-AGU-36][BE-UT] predicts when an over-pace window will exhaust', () => {
    const behind = model({ window: window('5h', 20, now + 2.5 * hour) });
    assert.equal(behind.tone, 'behind');
    assert.equal(behind.reserve, 0);
    assert.equal(behind.lastsUntilReset, false);
    assert.equal(behind.exhaustsAt, now + 2250);
  });

  test('[TC-AGU-37][BE-UT] omits predictions without a valid active reset window', () => {
    for (const reset of [null, now - 1, now + 6 * hour]) {
      assert.deepEqual(model({ window: window('5h', 20, reset) }), { tone: 'unknown' });
    }
  });

  test('[TC-AGU-38][BE-UT] handles a window that just started without dividing by zero', () => {
    const full = model({ window: window('5h', 100, now + 5 * hour) });
    assert.equal(full.expectedRemaining, 1);
    assert.equal(full.lastsUntilReset, true);
    const partial = model({ window: window('5h', 80, now + 5 * hour) });
    assert.equal(partial.expectedRemaining, 1);
    assert.equal(partial.exhaustsAt, undefined);
    assert.equal(partial.lastsUntilReset, undefined);
  });

  test('[TC-AGU-39][BE-UT] estimates weekly session quotas and counts a partial five-hour window', () => {
    const weekly = window('7d', 12, now + 26 * hour);
    assert.deepEqual(model({ window: weekly, session: claude.windows[0], cost: 5 }), [2.4, 6]);
    assert.equal(model({ window: weekly, cost: 5 }), null);
    assert.equal(model({ window: weekly, session: claude.windows[0], cost: 0 }), null);
  });
});
