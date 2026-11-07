// The themed SVG/HTML output: house style, standalone files, one clean line per connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { convert, THEMES } from '../src/convert.mjs';
import { skinPage } from '../src/skin.mjs';
import { buildHtml } from '../src/html.mjs';

const bin = fileURLToPath(new URL('../bin/mmd2drawio.mjs', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const th = THEMES.blue;
const skin = (src, o = {}) => skinPage(convert(src), { th, ...o });
const count = (s, re) => (s.match(re) ?? []).length;
const LINE = /<path d="M[^"]*" fill="none" stroke="#3d4c5c"/g;

const BOTH_WAYS = `flowchart LR
  A[ระบบ] --> B[ผู้อนุมัติ]
  B --> A
  A --> B`;

test('a pair of lines running both ways, or written twice, becomes one line with two heads', () => {
  const { svg } = skin(BOTH_WAYS);
  assert.equal(count(svg, LINE), 1);
  assert.equal(count(svg, /<polygon points="[^"]*" fill="#3d4c5c"/g), 2);
});

test('lines with different labels between the same boxes stay separate', () => {
  const { svg } = skin('flowchart LR\n  A -->|ส่ง| B\n  B -->|ตอบ| A');
  assert.equal(count(svg, LINE), 2);
});

test('house style: rounded cards, orange decisions, blue focus, Anuphan', () => {
  const { svg } = skin('flowchart TB\n  A[เริ่ม] --> B{ตัดสิน}\n  B --> C[จบ]\n  classDef focal fill:#3598dc,stroke:#3598dc,color:#ffffff\n  class C focal');
  assert.match(svg, /font-family="'Anuphan'/);
  assert.match(svg, /rx="12"/);
  assert.match(svg, /fill="#fdeadb" stroke="#b4540a"/);
  assert.match(svg, /fill="#1d5fbf" stroke="#17212b"/);
  assert.ok(!svg.includes('#3598dc'), 'theme accent is mapped to the house blue');
});

test('subgraphs get a role color each and a pill title', () => {
  const { svg } = skin('flowchart LR\n  subgraph P[พนักงาน]\n    A[ขอ]\n  end\n  subgraph Q[ผู้อนุมัติ]\n    B[ตอบ]\n  end\n  A --> B');
  assert.match(svg, /stroke="#1d5fbf" stroke-width="1.5" stroke-dasharray="7 5"/);
  assert.match(svg, /stroke="#0f6b4f" stroke-width="1.5" stroke-dasharray="7 5"/);
  assert.match(svg, /พนักงาน/);
});

test('every kind renders: no NaN, no theme leftovers, valid XML', () => {
  for (const f of readdirSync(fixtures).filter((n) => n.endsWith('.mmd'))) {
    const { svg } = skin(readFileSync(join(fixtures, f), 'utf8'));
    assert.ok(svg.startsWith('<?xml'), f);
    assert.ok(!/NaN|undefined/.test(svg), `${f}: NaN or undefined in svg`);
    assert.ok(!svg.includes('#3598dc'), `${f}: theme accent left`);
    execFileSync('xmllint', ['--noout', '-'], { input: svg, stdio: ['pipe', 'ignore', 'pipe'] });
  }
});

test('HTML page is standalone, light only, no middot, with Anuphan and the source kept', () => {
  const html = buildHtml([{ name: 'a', heading: 'ภาพ <ทดสอบ>', svg: skin(BOTH_WAYS, { inline: true }).svg, source: 'flowchart LR\n A-->B' }]);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /color-scheme:light/);
  assert.match(html, /family=Anuphan/);
  assert.ok(!/prefers-color-scheme: ?dark/.test(html));
  assert.ok(!html.includes('·'));
  assert.match(html, /<title>ภาพ &lt;ทดสอบ&gt;<\/title>/);
  assert.match(html, /<pre>flowchart LR/);
  assert.match(html, /<svg[^>]*viewBox/);
});

function run(args) {
  const out = mkdtempSync(join(tmpdir(), 'mmd2drawio-skin-'));
  const r = spawnSync('node', [bin, ...args, '-o', out], { encoding: 'utf8' });
  return { out, r, files: readdirSync(out).sort() };
}

test('CLI default writes one .html and nothing else', () => {
  const { r, files } = run([join(fixtures, '1-flowchart.mmd')]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(files, ['1-flowchart.html']);
});

test('CLI --svg is SVG only; --html and --drawio are opt-in additions', () => {
  assert.deepEqual(run([join(fixtures, '1-flowchart.mmd'), '--svg']).files, ['1-flowchart.svg']);
  assert.deepEqual(run([join(fixtures, '1-flowchart.mmd'), '--svg', '--html']).files, ['1-flowchart.html', '1-flowchart.svg']);
  assert.deepEqual(run([join(fixtures, '1-flowchart.mmd'), '--drawio']).files, ['1-flowchart.drawio', '1-flowchart.html']);
});

test('CLI multi-page Markdown: one HTML with a figure per diagram, one SVG per page', () => {
  const md = join(fixtures, '8-doc.md');
  const html = run([md]);
  assert.equal(html.files.length, 1);
  assert.ok(count(readFileSync(join(html.out, html.files[0]), 'utf8'), /class="fig"/g) >= 2);
  const svg = run([md, '--svg']);
  assert.ok(svg.files.length >= 2 && svg.files.every((f) => /-\d\.svg$/.test(f)), svg.files.join());
});

test('--strict still stops before writing any HTML when a check fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mmd2drawio-skin-'));
  const f = join(dir, 'bad.mmd');
  writeFileSync(f, 'flowchart LR\n  A[x] --> B[y]\n  %% route: A -> C\n');
  const r = spawnSync('node', [bin, f, '--strict', '-o', join(dir, 'o')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(join(dir, 'o', 'bad.html')));
});

test('CLI --png writes a real PNG in the new style (skipped when Chrome is missing)', (t) => {
  if (!existsSync('/Applications/Google Chrome.app')) return t.skip('no Chrome');
  const { r, files, out } = run([join(fixtures, '1-flowchart.mmd'), '--png']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(files, ['1-flowchart.html', '1-flowchart.png']);
  assert.equal(readFileSync(join(out, '1-flowchart.png')).subarray(1, 4).toString(), 'PNG');
});
