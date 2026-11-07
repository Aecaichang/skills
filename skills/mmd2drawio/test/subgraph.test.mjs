import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { convert, toMxfile, THEMES } from '../src/convert.mjs';
import { readClusters } from '../src/svg.mjs';

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/9-subgraph.mmd', import.meta.url)), 'utf8');
const bin = fileURLToPath(new URL('../bin/mmd2drawio.mjs', import.meta.url));

const attrOf = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
/** Every shape as { id, value, style, parent, x, y, w, h }, wrapped <object> cells included. */
function shapes(model) {
  return [...model.matchAll(/<(?:mxCell id="([^"]+)" value="([^"]*)"|object id="([^"]+)" label="([^"]*)"[^>]*><mxCell) style="([^"]*)" vertex="1" parent="([^"]+)"><mxGeometry x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)]
    .map((m) => ({ id: m[1] ?? m[3], value: m[2] ?? m[4], style: m[5], parent: m[6], x: +m[7], y: +m[8], w: +m[9], h: +m[10] }));
}
const edges = (model) => [...model.matchAll(/<mxCell [^>]*edge="1"[^>]*>[\s\S]*?<\/mxCell>/g)].map((m) => m[0]);
const frames = (model) => shapes(model).filter((s) => /container=1/.test(s.style));
const byValue = (model, value) => shapes(model).find((s) => s.value === value);

test('subgraphs become draw.io containers that carry their titles', () => {
  const r = convert(fixture);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(frames(r.model).map((f) => f.value).sort(), ['ขั้นที่ 1 รับคำขอ', 'ขั้นที่ 2 อนุมัติ', 'ขั้นที่ 3 ปิดงาน']);
});

test('boxes sit inside their container, positioned relative to it', () => {
  const m = convert(fixture).model;
  const step1 = frames(m).find((f) => f.value.startsWith('ขั้นที่ 1'));
  for (const name of ['รับคำขอ', 'ตรวจเอกสาร']) {
    const box = byValue(m, name);
    assert.equal(box.parent, step1.id, `${name} is a child of its frame`);
    assert.ok(box.x >= 0 && box.x + box.w <= step1.w && box.y >= 0 && box.y + box.h <= step1.h, `${name} fits inside`);
  }
  assert.equal(byValue(m, 'รอเอกสาร').parent, '1', 'a box outside every subgraph stays on the page');
});

test('a frame is written before anything placed inside it', () => {
  const m = convert('flowchart LR\n  subgraph O[นอก]\n    subgraph I[ใน]\n      A --> B\n    end\n  end\n').model;
  const list = shapes(m);
  for (const s of list.filter((c) => c.parent !== '1')) {
    assert.ok(list.findIndex((c) => c.id === s.parent) < list.indexOf(s), `${s.value} comes after its parent`);
  }
});

test('nested subgraphs nest as containers and keep both titles', () => {
  const m = convert('flowchart LR\n  subgraph O[นอก]\n    subgraph I[ใน]\n      A --> B\n    end\n    C\n  end\n').model;
  const outer = byValue(m, 'นอก'), inner = byValue(m, 'ใน');
  assert.equal(outer.parent, '1');
  assert.equal(inner.parent, outer.id);
  assert.equal(byValue(m, 'A').parent, inner.id);
  assert.equal(byValue(m, 'C').parent, outer.id);
});

test('an edge into or out of a subgraph attaches to its container', () => {
  const r = convert(fixture);
  assert.deepEqual(r.warnings, []);
  const m = r.model;
  const step2 = frames(m).find((f) => f.value.startsWith('ขั้นที่ 2'));
  const into = edges(m).find((e) => attrOf(e, 'source') === byValue(m, 'รอเอกสาร').id);
  const out = edges(m).find((e) => attrOf(e, 'target') === byValue(m, 'บันทึกผล').id);
  assert.equal(attrOf(into, 'target'), step2.id);
  assert.equal(attrOf(out, 'source'), step2.id);
});

test('a line inside a frame moves with it: stored in the frame, points relative to it', () => {
  // the bend comes from a third box beside the pair, so the route has a point to check
  const src = 'flowchart TD\n  subgraph S[กลุ่ม]\n    A --> B\n    A --> C\n    B --> D\n    C --> D\n  end\n';
  const m = convert(src).model;
  const frame = byValue(m, 'กลุ่ม');
  const inner = edges(m);
  assert.ok(inner.length === 4);
  for (const e of inner) {
    assert.equal(attrOf(e, 'parent'), frame.id);
    for (const [, x, y] of e.matchAll(/<mxPoint x="([\d.-]+)" y="([\d.-]+)"(?! as="offset")/g)) {
      assert.ok(+x >= 0 && +x <= frame.w && +y >= 0 && +y <= frame.h, `point ${x},${y} is in frame coordinates`);
    }
  }
});

test('a line between two subgraphs stays on the page with page coordinates', () => {
  const m = convert(fixture).model;
  const cross = edges(m).find((e) => attrOf(e, 'source') === byValue(m, 'ตรวจเอกสาร').id);
  assert.equal(attrOf(cross, 'parent'), '1');
});

test('title and source notes keep working around containers', () => {
  const src = fixture.replace('flowchart LR\n', 'flowchart LR\n  %% src A: api/Leave.cs:120\n');
  const r = convert(src, { title: 'ขั้นตอน', legend: true });
  assert.deepEqual(r.warnings, []);
  const list = shapes(r.model);
  const heading = byValue(r.model, 'ขั้นตอน');
  const top = Math.min(...frames(r.model).map((f) => f.y));
  assert.ok(heading.y + heading.h <= top, 'heading sits above the frames');
  const tag = byValue(r.model, 'S1'), box = list.find((s) => s.value === 'รับคำขอ');
  assert.equal(tag.parent, box.parent, 'the S1 tag moves with its box');
  assert.ok(Math.abs(tag.x + tag.w / 2 - (box.x + box.w)) < 1, 'tag sits on the box corner');
  assert.doesNotThrow(() => toMxfile([r]));
});

test('style and classDef on a subgraph carry over', () => {
  const src = 'flowchart LR\n  subgraph S[กลุ่ม]\n    A\n  end\n  style S fill:#fff4d6,stroke:#e0b84c,stroke-width:3px,stroke-dasharray:4 3,color:#aa0000\n';
  assert.match(frames(convert(src).model)[0].style, /fontColor=#aa0000;.*fillColor=#fff4d6;.*strokeColor=#e0b84c;strokeWidth=3;dashed=1;/);
});

test('without its own colors a frame uses the theme, in both themes', () => {
  for (const theme of ['blue', 'neutral']) {
    const { alt, border } = THEMES[theme];
    assert.match(frames(convert(fixture, { theme }).model)[0].style, new RegExp(`fillColor=${alt};.*strokeColor=${border};`));
  }
});

test('a two-line title stays on two lines', () => {
  const m = convert('flowchart LR\n  subgraph S[บรรทัดหนึ่ง<br/>บรรทัดสอง]\n    A\n  end\n').model;
  assert.equal(frames(m)[0].value, 'บรรทัดหนึ่ง&lt;br&gt;บรรทัดสอง');
});

test('composite states become containers with every transition attached', () => {
  const src = 'stateDiagram-v2\n  [*] --> Outer\n  state Outer {\n    [*] --> A\n    A --> B\n  }\n  Outer --> Done\n';
  const r = convert(src);
  assert.deepEqual(r.warnings, []);
  const outer = byValue(r.model, 'Outer');
  assert.match(outer.style, /container=1/);
  assert.equal(byValue(r.model, 'A').parent, outer.id);
  for (const e of edges(r.model)) assert.match(e, /source="[^"]+" target="[^"]+"/);
});

test('a line that crosses a frame title is reported, because draw.io draws lines over labels', () => {
  const r = convert('flowchart TD\n  X --> Y\n  subgraph S[ชื่อกลางกล่อง]\n    Y\n  end\n');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /\[edge-through-title\] "ชื่อกลางกล่อง"/);
  assert.match(byValue(r.model, 'ชื่อกลางกล่อง').style, /container=1/, 'the frame is still drawn');
});

test('a frame this diagram type cannot draw warns instead of vanishing', () => {
  const ns = convert('classDiagram\n  namespace Sales {\n    class A\n  }\n');
  assert.match(ns.warnings.join(), /\[cluster-dropped\] "Sales"/);
  const box = convert('sequenceDiagram\n  box Team\n    participant A\n  end\n  A->>A: hi\n');
  assert.match(box.warnings.join(), /\[cluster-dropped\] "Team"/);
});

test('a cluster with no box to read is reported as unreadable, not skipped', () => {
  const svg = '<svg><g class="pele-clusters"><g class="pele-cluster" data-id="S"><path d="M0,0"/></g></g></svg>';
  assert.deepEqual(readClusters(svg).map((c) => [c.id, c.w]), [['S', undefined]]);
});

test('--strict stops on a frame that would be lost and passes one that is drawn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mmd2drawio-'));
  writeFileSync(join(dir, 'lost.mmd'), 'classDiagram\n  namespace Sales {\n    class A\n  }\n');
  writeFileSync(join(dir, 'kept.mmd'), fixture);
  const run = (name) => spawnSync('node', [bin, join(dir, name), '--drawio', '--strict'], { encoding: 'utf8' });
  const lost = run('lost.mmd');
  assert.equal(lost.status, 1);
  assert.match(lost.stderr, /cluster-dropped/);
  assert.equal(run('kept.mmd').status, 0);
});
