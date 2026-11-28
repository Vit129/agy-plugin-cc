import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as strings from '../apps/agent-usage/ui/strings.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const ui = 'apps/agent-usage/ui';
const listTests = () => [
  ...readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.mjs')).map(name => `tests/${name}`),
  ...readdirSync(path.join(root, 'tests/tests-web')).filter(name => name.endsWith('.spec.mjs')).map(name => `tests/tests-web/${name}`),
];
const lines = text => text.split('\n').map((line, index) => ({ line, number: index + 1 }));
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '');
// Remove the :root / theme blocks (the token definitions) so everything left is a consumer of tokens.
const withoutTokenBlocks = css => css.replace(/:root[^{]*\{[^}]*\}/g, match => match.replace(/[^\n]/g, ' '));
const offenders = (file, text, pattern) => lines(text).filter(({ line }) => pattern.test(line)).map(({ line, number }) => `${file}:${number}: ${line.trim()}`);

const hexLiteral = /#[0-9a-fA-F]{3,8}\b(?![-\w])/;
const nonHexHash = /href="#|\{ '#|#settings\b|#[g-z]/i;
const findHexOffenders = (file, text) => offenders(file, text, hexLiteral).filter(entry => !nonHexHash.test(entry));

test('[TC-AGU-88][BE-UT][Security] no hex colour outside the :root token blocks of styles.css', () => {
  const found = [
    ...offenders('styles.css', withoutTokenBlocks(stripComments(read(`${ui}/styles.css`))), /#[0-9a-fA-F]{3,8}\b/),
    ...['dashboard.mjs', 'strings.mjs', 'index.html'].flatMap(file => findHexOffenders(file, stripComments(read(`${ui}/${file}`)))),
  ];
  assert.deepEqual(found, [], 'Define colours as a token in :root and use var(--token).');
  assert.equal(findHexOffenders('sample.mjs', "const c = '#deadbeef';").length, 1);
});

test('[TC-AGU-89][BE-UT] every font-size outside :root is a --text-* token', () => {
  const found = offenders('styles.css', withoutTokenBlocks(stripComments(read(`${ui}/styles.css`))), /font-size\s*:(?!\s*var\(--text-)/);
  assert.deepEqual(found, [], 'Add a step to the type scale in :root (--text-*) and use var(--text-*).');
});

test('[TC-AGU-90][BE-UT] dashboard.mjs holds no quota rule or fixed time zone', () => {
  const code = stripComments(read(`${ui}/dashboard.mjs`));
  const found = offenders('dashboard.mjs', code, /autoRoute\s*===|capacity\s*>=|severity\[|\.level\s*===|Asia\/Bangkok|\bICT\b/);
  assert.deepEqual(found, [], 'Move the rule into view-model.mjs; the dashboard only renders its result.');
});

test('[TC-AGU-91][BE-UT] no Asia/Bangkok or ICT literal in shipped Agent Usage code', () => {
  const files = ['server.mjs', 'view-model.mjs', 'quota.mjs', `ui/dashboard.mjs`, 'ui/strings.mjs'].map(file => `apps/agent-usage/${file}`);
  const found = files.flatMap(file => offenders(file, stripComments(read(file)), /Asia\/Bangkok|\bICT\b/));
  assert.deepEqual(found, [], 'Use the viewer time zone from the view-model, never a fixed one.');
});

test('[TC-AGU-92][BE-UT] dashboard text comes from strings.mjs and every referenced key exists', () => {
  const missing = [];
  for (const file of [`${ui}/dashboard.mjs`, 'apps/agent-usage/view-model.mjs']) {
    const code = stripComments(read(file));
    for (const [, group, key] of code.matchAll(/\b(text|format|levelLabels|stateLabels|windowNames|routeNames|creditStatusLabels|accountKindLabels)\.(\w+)/g)) {
      if (!(key in strings[group])) missing.push(`${file}: ${group}.${key}`);
    }
  }
  assert.deepEqual(missing, []);
  const literals = offenders('dashboard.mjs', stripComments(read(`${ui}/dashboard.mjs`)), /textContent\s*=\s*['"`](?!['"`])/);
  assert.deepEqual(literals, [], 'Add the text to ui/strings.mjs and reference it.');
});

test('[TC-AGU-93][BE-UT] every test title carries an id and a [BE|FE-BL|UT|IT] tag, and ids are unique', () => {
  const untagged = [];
  const seen = new Map();
  for (const file of listTests()) {
    for (const { line, number } of lines(read(file))) {
      const title = /\btest(?:\.(?!describe)\w+)?\(\s*(["'`])(.+?)\1\s*,/.exec(line)?.[2];
      if (title === undefined) continue;
      const match = /^\[((?:TC|TS)-[A-Z0-9-]+|(?:TC|TS)-[A-Z]+-\$\{\w+\})\]\s?\[(?:BE|FE)-(?:BL|UT|IT)\]/.exec(title);
      if (!match) { untagged.push(`${file}:${number}: ${title}`); continue; }
      const id = match[1];
      if (id.includes('${')) continue; // generated ids are listed explicitly in the spec loop
      if (seen.has(id)) untagged.push(`${file}:${number}: duplicate id ${id} (also ${seen.get(id)})`);
      seen.set(id, `${file}:${number}`);
    }
  }
  assert.deepEqual(untagged, [], 'Title format: [TC-<AREA>-NN][BE|FE-BL|UT|IT] ...');
});

test('[TC-AGU-94][BE-UT][Security] no test spawns launchctl and only one runner touches it in product code', () => {
  const found = listTests().flatMap(file => offenders(file, stripComments(read(file)), /(?:spawn|exec)\w*\([^)]*launchctl|\/bin\/launchctl/)
    .filter(() => !file.endsWith('architecture-guard.test.mjs')));
  assert.deepEqual(found, [], 'Inject a fake launchctl runner into launch-agents.mjs; never call the real one from a test.');
  const code = stripComments(read('apps/agent-usage/launch-agents.mjs'));
  assert.equal(code.match(/(?:spawnSync|execFileSync|execFile|spawn)\(\s*launchctl\b/g)?.length, 1, 'launchctl must be spawned in realLaunchctl only.');
});
