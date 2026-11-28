import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const swift = spawnSync('swiftc', ['--version']);
const reset = Date.UTC(2026, 10, 30, 17) / 1000;
const window = (short, remaining, resetsAt = reset) => ({ short, remaining, resetsAt, level: 'low', state: 'live' });

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
      'apps/agent-usage/menubar/StatusTitle.swift',
      'tests/fixtures/StatusTitleMain.swift',
      '-o', executable,
    ], { cwd: root, stdio: 'pipe' });
  });

  after(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  function title(amount, windows, glyph) {
    return JSON.parse(execFileSync(executable, {
      input: JSON.stringify({ amount, windows, glyph, timeZone: 'Asia/Bangkok' }),
      encoding: 'utf8',
    }));
  }

  test('[TC-AGU-30][FE-UT] formats a five-hour reset at local midnight in 24-hour time', () => {
    assert.deepEqual(title('21%', [window('5h', 21.8)]), ['21%', '5h −1 Dec at 00:00']);
  });

  test('[TC-AGU-31][FE-UT] identifies the weekly window before rounding the displayed percentage', () => {
    assert.deepEqual(title('21%', [window('5h', 21.8), window('7d', 21.2, reset + 7 * 3600)], 'O'),
      ['O 21%', 'W −1 Dec at 07:00']);
  });

  test('[TC-AGU-32][FE-UT] formats the monthly window and a 24-hour afternoon time', () => {
    assert.deepEqual(title('0%', [window('monthly', 0, reset + 17 * 3600)], 'G'), ['G 0%', 'M −1 Dec at 17:00']);
  });

  test('[TC-AGU-33][FE-UT] keeps one line when the limiting window has no reset', () => {
    assert.deepEqual(title('21%', [window('monthly', 21.2, null), window('7d', 21.8)], 'G'), ['G 21%', null]);
  });

  test('[TC-AGU-34][FE-UT] keeps one line when quota is unavailable or the snapshot amount differs', () => {
    assert.deepEqual(title('—', [window('5h', null), window('7d', 101)], 'C'), ['C —', null]);
    assert.deepEqual(title('42%', [window('5h', 35)]), ['42%', null]);
  });
});
