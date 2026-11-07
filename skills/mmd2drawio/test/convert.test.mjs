import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { convert, toMxfile, mermaidBlocks, THEMES } from '../src/convert.mjs';
import { splitEr } from '../src/er-split.mjs';

const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const bin = fileURLToPath(new URL('../bin/mmd2drawio.mjs', import.meta.url));
const fixture = (name) => readFileSync(join(dir, name), 'utf8');
const edges = (model) => [...model.matchAll(/<mxCell [^>]*edge="1"[^>]*>/g)].map((m) => m[0]);
const vertices = (model) => (model.match(/vertex="1"/g) ?? []).length;

function isWellFormed(xml) {
  try {
    execFileSync('xmllint', ['--noout', '-'], { input: xml, stdio: ['pipe', 'ignore', 'pipe'] });
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return true; // xmllint not installed: skip this check
    return false;
  }
}

const NATIVE_CASES = [
  ['1-flowchart.mmd', 'flowchart', 9, 10],
  ['2-sequence.mmd', 'sequence', 4, 11],
  ['3-state.mmd', 'state', 7, 10],
  ['4-er.mmd', 'er', 4, 5],
  ['6-class.mmd', 'class', 4, 4],
];

for (const [file, kind, minVertices, connectedEdges] of NATIVE_CASES) {
  test(`${kind}: converts to native shapes with every edge connected`, () => {
    const r = convert(fixture(file));
    assert.equal(r.kind, kind);
    assert.equal(r.native, true);
    assert.deepEqual(r.warnings, []);
    assert.ok(vertices(r.model) >= minVertices, `expected at least ${minVertices} shapes`);
    // dashed dividers inside sequence frames are free lines; every other edge must be attached
    const attached = edges(r.model).filter((e) => !/endArrow=none;dashed=1/.test(e));
    assert.equal(attached.length, connectedEdges);
    for (const e of attached) assert.match(e, /source="[^"]+" target="[^"]+"/);
    assert.ok(isWellFormed(toMxfile([r])), 'output is well-formed XML');
  });
}

test('sequence self-message stays a small loop beside its own lifeline', () => {
  const r = convert('sequenceDiagram\n  participant C as Cashier\n  participant O as ระบบการขาย\n  C->>O: a\n  O->>O: self call\n  O-->>C: b\n');
  const self = r.model.match(/<mxCell [^>]*value="self call"[^>]*>[\s\S]*?<\/mxCell>/)[0];
  const src = attrOf(self, 'source');
  assert.equal(attrOf(self, 'target'), src);
  const xs = [...self.matchAll(/<mxPoint x="([\d.-]+)" y="[\d.-]+"(?! as="offset")/g)].map((m) => +m[1]);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 40, `loop is narrow, got x range ${Math.min(...xs)}..${Math.max(...xs)}`);
});
const attrOf = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

test('keeps Thai labels and uses the Sarabun font', () => {
  const r = convert(fixture('1-flowchart.mmd'));
  assert.match(r.model, /วันลาคงเหลือพอไหม/);
  assert.match(r.model, /fontFamily=Sarabun/);
});

test('every font style tells draw.io where to load Sarabun from', () => {
  for (const file of ['1-flowchart.mmd', '2-sequence.mmd', '4-er.mmd', '6-class.mmd']) {
    const m = convert(fixture(file)).model;
    const families = (m.match(/fontFamily=Sarabun/g) ?? []).length;
    const sources = (m.match(/fontFamily=Sarabun;fontSource=https%3A%2F%2Ffonts\.googleapis\.com%2Fcss%3Ffamily%3DSarabun;/g) ?? []).length;
    assert.ok(families > 0);
    assert.equal(sources, families, `${file}: every Sarabun style has a fontSource`);
  }
});

test('blue is the default theme and neutral can be chosen', () => {
  assert.match(convert(fixture('3-state.mmd')).model, new RegExp(THEMES.blue.paper));
  assert.match(convert(fixture('3-state.mmd'), { theme: 'neutral' }).model, new RegExp(THEMES.neutral.paper));
  assert.throws(() => convert(fixture('3-state.mmd'), { theme: 'sarabun' }), /unknown theme/);
});

test('classDef colors from Mermaid carry over to draw.io', () => {
  const src = `${fixture('1-flowchart.mmd')}  classDef focal fill:#eb6c36,stroke:#eb6c36,color:#ffffff\n  class OK focal\n`;
  assert.match(convert(src).model, /fontColor=#ffffff;fillColor=#eb6c36;strokeColor=#eb6c36/);
});

test('ER cardinalities map to draw.io crow-foot arrows', () => {
  const m = convert(fixture('4-er.mmd')).model;
  assert.match(m, /ERmandOne/);
  assert.match(m, /ERzeroToMany/);
});

test('ER entities are draw.io tables with key | name | type columns and the hub entity in accent', () => {
  const m = convert(fixture('4-er.mmd')).model;
  assert.equal((m.match(/shape=table;/g) ?? []).length, 4);
  assert.match(m, /value="FK"[^>]*>[\s\S]*?value="manager_id"[\s\S]*?value="int"/);
  const header = (name) => m.match(new RegExp(`value="${name}" style="shape=table;[^"]*fillColor=(#[0-9a-f]+)`))[1];
  assert.equal(header('LEAVE_REQUEST'), THEMES.blue.accent, 'most-connected entity (self-links not counted)');
  assert.equal(header('EMPLOYEE'), THEMES.blue.ink);
});

test('ER without a direction is laid out left to right', () => {
  const xs = [...convert(fixture('4-er.mmd')).model.matchAll(/style="shape=table;[^"]*" vertex="1" parent="1"><mxGeometry x="([\d.]+)"/g)].map((m) => +m[1]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 500, `tables spread sideways, x range ${Math.min(...xs)}..${Math.max(...xs)}`);
});

test('class relations keep their UML ends', () => {
  const m = convert(fixture('6-class.mmd')).model;
  assert.match(m, /Arrow=block;\w+Fill=0/, 'inheritance: hollow triangle');
  assert.match(m, /Arrow=diamondThin;\w+Fill=1/, 'composition: filled diamond');
  assert.match(m, /«enumeration»/);
});

test('other diagram types become one image that keeps the Mermaid source', () => {
  const horizontal = 'xychart-beta horizontal\n  x-axis [a, b]\n  bar [3, 5]\n';
  for (const src of [fixture('7-pie.mmd'), horizontal]) {
    const r = convert(src);
    assert.equal(r.native, false);
    assert.match(r.model, /shape=image;.*image=data:image\/svg\+xml,/);
    assert.match(r.model, /mermaid="[^"]+"/);
    assert.ok(isWellFormed(toMxfile([r])));
  }
});

test('finds only mermaid blocks in Markdown and reads front-matter titles', () => {
  const blocks = mermaidBlocks(fixture('8-doc.md'));
  assert.equal(blocks.length, 2);
  assert.equal(convert(blocks[1]).title, 'สถานะ');
});

test('CLI converts a folder and a Markdown file into multi-page output', () => {
  const out = mkdtempSync(join(tmpdir(), 'mmd2drawio-'));
  const log = execFileSync('node', [bin, dir, '-o', out, '--drawio'], { encoding: 'utf8' });
  assert.match(log, /เสร็จ 9 ไฟล์/);
  for (const name of ['1-flowchart', '6-class', '7-pie', '8-doc']) assert.ok(existsSync(join(out, `${name}.drawio`)));
  assert.equal((readFileSync(join(out, '8-doc.drawio'), 'utf8').match(/<diagram /g) ?? []).length, 2);
});

test('CLI keeps sub-folders under -o so same-named files do not overwrite each other', () => {
  const work = mkdtempSync(join(tmpdir(), 'mmd2drawio-'));
  for (const sub of ['a', 'b']) {
    mkdirSync(join(work, 'docs', sub), { recursive: true });
    writeFileSync(join(work, 'docs', sub, 'same.mmd'), `flowchart TD\n  ${sub.toUpperCase()} --> Z`);
  }
  const out = join(work, 'out');
  execFileSync('node', [bin, join(work, 'docs'), '-o', out, '--drawio'], { encoding: 'utf8' });
  assert.match(readFileSync(join(out, 'a', 'same.drawio'), 'utf8'), /value="A"/);
  assert.match(readFileSync(join(out, 'b', 'same.drawio'), 'utf8'), /value="B"/);
});

test('CLI reports a broken diagram and keeps going', () => {
  const work = mkdtempSync(join(tmpdir(), 'mmd2drawio-'));
  writeFileSync(join(work, 'bad.mmd'), 'flowchart TD\n  A --> \n  ((((');
  writeFileSync(join(work, 'good.mmd'), 'flowchart TD\n  A --> B');
  let log = '', code = 0;
  try { execFileSync('node', [bin, work, '--drawio'], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { log = e.stdout + e.stderr; code = e.status; }
  assert.equal(code, 1);
  assert.match(log, /✗ bad/);
  assert.ok(existsSync(join(work, 'good.drawio')));
});

test('vertical bar charts become one draw.io rectangle per bar with its value on top', () => {
  const r = convert(fixture('5-bar.mmd'));
  assert.equal(r.native, true);
  assert.equal((r.model.match(/style="rounded=0;html=1;fillColor=/g) ?? []).length, 6);
  for (const v of ['6.5', '12.4', '10.3', 'คลังสินค้า', 'วันลาเฉลี่ยต่อคน ปี 2569 แยกตามฝ่าย']) assert.match(r.model, new RegExp(`value="${v}"`));
  assert.ok(isWellFormed(toMxfile([r])));
});

test('bar + line charts keep the line as a draw.io polyline', () => {
  const r = convert('xychart-beta\n  x-axis [a, b, c]\n  y-axis 0 --> 10\n  bar [3, 5, 7]\n  line [2, 6, 4]\n');
  assert.equal(r.native, true);
  assert.match(r.model, /endArrow=none;html=1;strokeColor=[^;]+;strokeWidth=2;/);
});

test('title and legend options add a heading and a key that fits the diagram', () => {
  const flow = convert(fixture('1-flowchart.mmd'), { title: 'ขั้นตอนอนุมัติใบลา', legend: true }).model;
  for (const t of ['ขั้นตอนอนุมัติใบลา', 'สัญลักษณ์', 'เริ่ม / จบ', 'การตัดสินใจ']) assert.match(flow, new RegExp(`value="${t}"`));
  const er = convert(fixture('4-er.mmd'), { legend: true }).model;
  for (const t of ['คีย์หลัก', 'หนึ่งรายการเท่านั้น', 'ไม่มีหรือหลายรายการ']) assert.match(er, new RegExp(`value="${t}"`));
  assert.equal(convert('---\ntitle: จาก Mermaid\n---\nflowchart TD\n  A --> B\n', { title: true }).model.includes('value="จาก Mermaid"'), true);
  assert.match(convert(fixture('7-pie.mmd'), { legend: true }).warnings.join(), /no legend for pie/);
});

test('small ER: hub in the middle of the top row, a table linked to both sides goes below', () => {
  const m = convert(fixture('4-er.mmd')).model;
  const pos = (name) => m.match(new RegExp(`value="${name}" style="shape=table;[^"]*" vertex="1" parent="1"><mxGeometry x="([\\d.]+)" y="([\\d.]+)"`)).slice(1).map(Number);
  const [ex, ey] = pos('EMPLOYEE'), [hx, hy] = pos('LEAVE_REQUEST'), [tx, ty] = pos('LEAVE_TYPE'), [ax, ay] = pos('APPROVAL');
  assert.ok(ex < hx && hx < tx, 'EMPLOYEE | LEAVE_REQUEST | LEAVE_TYPE left to right');
  assert.equal(ey, hy); assert.equal(hy, ty);
  assert.ok(ay > hy, 'APPROVAL on the row below');
  assert.ok(Math.abs(ax - hx) < 40, 'APPROVAL under the hub');
});

// a schema shaped like a microservice database: one users table everything points at
function hubSchema() {
  const lines = ['erDiagram'];
  const t = (n) => `  ${n} {\n    uuid Id PK\n    uuid CreatedBy FK\n  }`;
  lines.push(t('TblUser'));
  for (const g of ['A', 'B']) for (let i = 0; i < 9; i++) lines.push(t(`Tbl${g}${i}`));
  for (const g of ['A', 'B']) for (let i = 1; i < 9; i++) lines.push(`  Tbl${g}0 ||--o{ Tbl${g}${i} : "has"`);
  for (const g of ['A', 'B']) for (let i = 0; i < 9; i++) lines.push(`  TblUser ||--o{ Tbl${g}${i} : "creates"`);
  lines.push(t('heartbeat'));
  return lines.join('\n') + '\n';
}

test('--split cuts a hub table out of an oversized ER and copies it onto each page', () => {
  const pages = splitEr(hubSchema());
  assert.deepEqual(pages.map((p) => p.name), ['TblA0 (9 ตาราง + 1 ตารางที่ใช้ร่วม)', 'TblB0 (9 ตาราง + 1 ตารางที่ใช้ร่วม)', 'ตารางที่ไม่มีความสัมพันธ์ (1)']);
  assert.match(pages[0].src, /%% focal: TblA0/);
  // every relationship of the original survives on some page
  const rels = (src) => (src.match(/^\s+\w+ [|}o]{2}--[|{o]{2} \w+/gm) ?? []).map((l) => l.trim());
  const all = new Set(pages.flatMap((p) => rels(p.src)));
  for (const r of rels(hubSchema())) assert.ok(all.has(r), `kept: ${r}`);
  for (const p of pages) assert.deepEqual(convert(p.src).warnings, []);
  const header = (src, name) => convert(src).model.match(new RegExp(`value="${name}" style="shape=table;[^"]*fillColor=(#[0-9a-f]+)`))[1];
  assert.equal(header(pages[0].src, 'TblA0'), THEMES.blue.accent, 'the page\'s own main table is the accent, not the copied hub');
});

test('--split leaves a single-group ER untouched', () => {
  const src = fixture('4-er.mmd');
  assert.deepEqual(splitEr(src), [{ src }]);
});

test('"%% legend <class>: <label>" names a custom color in Thai', () => {
  const src = 'flowchart TD\n  A[เปิดหน้า] --> B[กรอกข้อมูล]\n  classDef screen fill:#fff4d6,stroke:#e0b84c\n  class B screen\n  %% legend screen: ต้องดูจอ\n';
  const m = convert(src, { legend: true }).model;
  assert.match(m, /value="ต้องดูจอ"/);
  assert.doesNotMatch(m, /value="screen"/);
});

const PATH_SHAPES = ['[(ฐานข้อมูล)]', ...['doc', 'docs', 'tag-doc', 'lin-doc', 'curv-trap', 'bow-rect', 'delay', 'h-cyl', 'lin-cyl', 'cloud'].map((s) => `@{ shape: ${s}, label: "ฐานข้อมูล" }`)];

for (const shape of PATH_SHAPES) {
  test(`node drawn as a path keeps its size and its lines: ${shape}`, () => {
    const r = convert(`flowchart LR\n  A --> N${shape}\n  N --> B\n`);
    assert.deepEqual(r.warnings, []);
    const [, w, h] = r.model.match(/value="ฐานข้อมูล"[^>]*><mxGeometry x="[\d.-]+" y="[\d.-]+" width="([\d.]+)" height="([\d.]+)"/);
    assert.ok(+w >= 40 && +h >= 40, `size ${w}x${h}`);
    for (const e of edges(r.model)) assert.match(e, /source="[^"]+" target="[^"]+"/);
  });
}

test('a cylinder box covers both of its curved ends', () => {
  // Pele draws M-28,-24A28,6 ... V24A28,6 ...: a 48px side with a 6px curve at each end
  const [, y, w, h] = convert('flowchart LR\n  N[(x)]\n').model.match(/value="x"[^>]*><mxGeometry x="[\d.-]+" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/).map(Number);
  assert.equal(w, 56);
  assert.equal(h, 60);
  assert.equal(y, 28, 'top of the curve: 8px page padding + 20px margin');
});

test('classDef colors reach a node drawn as a path', () => {
  const src = 'flowchart LR\n  N[(ฐานข้อมูล)]\n  classDef store fill:#fff4d6,stroke:#e0b84c\n  class N store\n';
  assert.match(convert(src).model, /fillColor=#fff4d6;strokeColor=#e0b84c/);
});

test('a cylinder inside a subgraph is a child of its container', () => {
  const m = convert('flowchart LR\n  subgraph S[กลุ่ม]\n    N[(ฐานข้อมูล)]\n  end\n').model;
  const frame = m.match(/<mxCell id="([^"]+)" value="กลุ่ม"/)[1];
  assert.match(m, new RegExp(`value="ฐานข้อมูล"[^>]*parent="${frame}"`));
});
