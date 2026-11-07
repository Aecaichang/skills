import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { convert } from '../src/convert.mjs';
import { findLayoutIssues, parseNotes, checkSources } from '../src/check.mjs';

const bin = fileURLToPath(new URL('../bin/mmd2drawio.mjs', import.meta.url));
const box = (id, x, y, w = 100, h = 40, label = [id]) => ({ id, x, y, w, h, label, cls: 'pele-shape-rect' });
const codes = (list) => list.map((i) => i.code);

test('layout check reports two boxes that overlap', () => {
  const issues = findLayoutIssues([box('A', 0, 0), box('B', 50, 10)], []);
  assert.deepEqual(codes(issues), ['box-overlap']);
  assert.match(issues[0].detail, /A.*B/);
});

test('layout check ignores a box inside its container', () => {
  assert.deepEqual(findLayoutIssues([box('Group', 0, 0, 400, 300), box('A', 50, 50)], []), []);
});

test('layout check reports a line that crosses an unrelated box', () => {
  const [a, b, c] = [box('A', 0, 0), box('B', 400, 0), box('C', 200, 0)];
  const issues = findLayoutIssues([a, b, c], [{ id: 'e1', source: a, target: b, pts: [[100, 20], [400, 20]] }]);
  assert.deepEqual(codes(issues), ['edge-through-box']);
  assert.match(issues[0].detail, /C/);
});

test('layout check accepts a line that goes around a box', () => {
  const [a, b, c] = [box('A', 0, 0), box('B', 400, 0), box('C', 200, 0)];
  const pts = [[100, 20], [100, 80], [400, 80], [400, 40]];
  assert.deepEqual(findLayoutIssues([a, b, c], [{ id: 'e1', source: a, target: b, pts }]), []);
});

test('layout check reports a Thai label wider than its box', () => {
  const n = box('A', 0, 0, 60, 40, ['ตรวจสอบเอกสารการเบิกค่าใช้จ่าย']);
  assert.deepEqual(codes(findLayoutIssues([n], [])), ['label-overflow']);
});

test('reads source and route notes from Mermaid comments', () => {
  const notes = parseNotes('flowchart LR\n  %% src A: api/Leave.cs:120 r24867\n  %% route: A -> B -> C\n  A --> B\n');
  assert.deepEqual(notes.sources, [{ id: 'A', ref: 'api/Leave.cs:120 r24867', path: 'api/Leave.cs', line: 120 }]);
  assert.deepEqual(notes.route, ['A', 'B', 'C']);
});

test('source check confirms the file and line exist in the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'mmd2drawio-'));
  writeFileSync(join(root, 'a.cs'), 'one\ntwo\n');
  const refs = [
    { id: 'A', ref: 'a.cs:2', path: 'a.cs', line: 2 },
    { id: 'B', ref: 'a.cs:99', path: 'a.cs', line: 99 },
    { id: 'C', ref: 'gone.cs:1', path: 'gone.cs', line: 1 },
  ];
  assert.deepEqual(codes(checkSources(refs, root)), ['src-line-missing', 'src-file-missing']);
});

test('route colors only the lines it follows', () => {
  const r = convert('flowchart LR\n  %% route: A -> B\n  A --> B\n  B --> C\n');
  assert.deepEqual(r.warnings, []);
  const lines = [...r.model.matchAll(/<mxCell [^>]*edge="1"[^>]*>/g)].map((m) => m[0]);
  assert.equal(lines.filter((l) => l.includes('strokeColor=#3598dc')).length, 1);
});

test('route that follows no real line warns instead of drawing it', () => {
  const r = convert('flowchart LR\n  %% route: A -> C\n  A --> B\n  B --> C\n');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /route-no-edge/);
});

test('source note adds a tooltip, a badge and a list below the diagram', () => {
  const r = convert('flowchart LR\n  %% src A: api/Leave.cs:120\n  A --> B\n');
  assert.deepEqual(r.warnings, []);
  assert.match(r.model, /<object [^>]*tooltip="api\/Leave\.cs:120"/);
  assert.match(r.model, /value="S1"/);
  assert.match(r.model, /S1 api\/Leave\.cs:120/);
});

test('source tag on a diamond sits on its top point', () => {
  const r = convert('flowchart LR\n  %% src A: a.cs:1\n  A{ตรวจ} --> B\n');
  const [, x, w] = r.model.match(/<mxCell [^>]*><mxGeometry x="([\d.-]+)" y="[\d.-]+" width="([\d.-]+)"[^>]*\/><\/mxCell><\/object>/);
  const tag = r.model.match(/value="S1"[^>]*><mxGeometry x="([\d.-]+)"/)[1];
  assert.ok(Math.abs(+tag + 13 - (+x + +w / 2)) < 1, 'tag is centered on the diamond');
});

test('source note on an unknown node warns', () => {
  const r = convert('flowchart LR\n  %% src Z: a.cs:1\n  A --> B\n');
  assert.match(r.warnings[0], /src-unknown-node/);
});

test('--strict keeps the previous file when the check fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mmd2drawio-'));
  const out = join(dir, 'out');
  mkdirSync(out);
  writeFileSync(join(out, 'a.drawio'), 'last good');
  writeFileSync(join(dir, 'a.mmd'), 'flowchart LR\n  %% route: A -> C\n  A --> B\n  B --> C\n');
  const r = spawnSync('node', [bin, join(dir, 'a.mmd'), '-o', out, '--drawio', '--strict'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /route-no-edge/);
  assert.equal(readFileSync(join(out, 'a.drawio'), 'utf8'), 'last good');
});

test('--strict writes the file when the check passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mmd2drawio-'));
  writeFileSync(join(dir, 'a.mmd'), 'flowchart LR\n  A --> B\n');
  const r = spawnSync('node', [bin, join(dir, 'a.mmd'), '--drawio', '--strict'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(existsSync(join(dir, 'a.drawio')));
});
