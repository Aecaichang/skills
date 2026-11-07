// Optional title above and legend below a converted diagram (--title / --legend),
// so a page can go to other people without extra explanation.
import { FONT_STYLE, MARGIN } from './cells.mjs';
import { esc } from './svg.mjs';

const GAP = 28; // space between the diagram and its title or legend
const SWATCH_W = 40, SWATCH_H = 20, ITEM_GAP = 28;
const CHAR_W = 8;
const SOURCE_ROW = 20;
// Thai vowel and tone marks sit above or below a letter and take no width of their own
export const textWidth = (t) => t.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').length * CHAR_W + 8;

/** Bounding box of the top-level shapes already written. */
export function bounds(cells) {
  const boxes = cells.list
    .map((c) => c.match(/vertex="1" parent="1">\s*<mxGeometry x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/))
    .filter(Boolean).map((m) => m.slice(1).map(Number));
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...boxes.map((b) => b[0])), y = Math.min(...boxes.map((b) => b[1]));
  return { x, y, w: Math.max(...boxes.map((b) => b[0] + b[2])) - x, h: Math.max(...boxes.map((b) => b[1] + b[3])) - y };
}

export function addTitle(cells, th, title) {
  const b = bounds(cells);
  cells.vertex({
    value: title, x: b.x, y: b.y - GAP - 30, w: Math.max(b.w, title.length * 14), h: 30,
    style: `text;html=1;align=left;verticalAlign=middle;whiteSpace=wrap;${FONT_STYLE}fontSize=20;fontStyle=1;fontColor=${th.ink};`,
  });
}

/** Legend entries that fit what this diagram actually uses. */
function entries(kind, svg, model, th, labels = new Map()) {
  const has = (re) => re.test(svg);
  const box = (style) => ({ swatch: style });
  const lineSample = (style) => ({ line: style });
  const out = [];
  if (kind === 'flowchart') {
    if (has(/pele-shape-stadium/)) out.push({ ...box(`rounded=1;arcSize=50;fillColor=${th.node};strokeColor=${th.border};`), text: 'เริ่ม / จบ' });
    if (has(/pele-shape-rect/)) out.push({ ...box(`rounded=1;arcSize=10;fillColor=${th.node};strokeColor=${th.border};`), text: 'ขั้นตอน' });
    if (has(/pele-shape-diam/)) out.push({ ...box(`rhombus;fillColor=${th.node};strokeColor=${th.border};`), text: 'การตัดสินใจ' });
  }
  if (kind === 'state') {
    out.push({ ...box(`ellipse;fillColor=${th.ink};strokeColor=none;`), text: 'เริ่ม', size: 14 });
    out.push({ ...box(`rounded=1;arcSize=30;fillColor=${th.node};strokeColor=${th.border};`), text: 'สถานะ' });
    if (has(/pele-state-end/)) out.push({ ...box(`ellipse;shape=endState;fillColor=${th.ink};strokeColor=${th.ink};`), text: 'สิ้นสุด', size: 14 });
  }
  if (kind === 'flowchart' || kind === 'state') {
    // custom classDef colors: one entry per class name that carries its own fill
    const seen = new Set();
    for (const [, cls, fill] of svg.matchAll(/class="pele-node [^"]*?pele-[\w-]+ ([\w-]+)"[^>]*>(?:(?!<\/g>)[\s\S])*?style="[^"]*fill:(#[0-9a-fA-F]+)/g)) {
      if (seen.has(cls)) continue;
      seen.add(cls);
      out.push({ ...box(`rounded=1;arcSize=10;fillColor=${fill};strokeColor=${fill};`), text: labels.get(cls) ?? (cls === 'focal' ? 'จุดสำคัญ' : cls) });
    }
  }
  if (kind === 'sequence') {
    if (has(/pele-message"[^>]*><path d="[^"]*"\/>/)) out.push({ ...lineSample(`endArrow=block;endFill=1;strokeColor=${th.muted};`), text: 'ส่งคำขอ' });
    if (has(/stroke-dasharray="4 4"\/><path class="pele-marker"/)) out.push({ ...lineSample(`endArrow=block;endFill=1;dashed=1;strokeColor=${th.muted};`), text: 'ตอบกลับ' });
  }
  if (kind === 'er') {
    out.push({ key: 'PK', color: th.accent, text: 'คีย์หลัก' }, { key: 'FK', color: th.link, text: 'คีย์นอก' });
    const cards = new Set((model?.relationships ?? []).flatMap((r) => [r.relSpec.cardA, r.relSpec.cardB]));
    const names = { ONLY_ONE: ['ERmandOne', 'หนึ่งรายการเท่านั้น'], ZERO_OR_ONE: ['ERzeroToOne', 'ไม่มีหรือหนึ่งรายการ'], ONE_OR_MORE: ['ERoneToMany', 'หนึ่งรายการขึ้นไป'], ZERO_OR_MORE: ['ERzeroToMany', 'ไม่มีหรือหลายรายการ'] };
    for (const c of Object.keys(names)) {
      if (cards.has(c)) out.push({ ...lineSample(`endArrow=${names[c][0]};endFill=0;endSize=10;strokeColor=${th.link};`), text: names[c][1] });
    }
  }
  return out;
}

/** Returns false when this diagram type has no legend. */
export function addLegend(cells, th, kind, svg, model, labels) {
  const items = entries(kind, svg, model, th, labels);
  if (!items.length) return false;
  const b = bounds(cells);
  let x = b.x, y = b.y + b.h + GAP;
  const text = (value, tx, w) => cells.vertex({
    value, x: tx, y, w, h: SWATCH_H,
    style: `text;html=1;align=left;verticalAlign=middle;whiteSpace=nowrap;${FONT_STYLE}fontSize=13;fontColor=${th.muted};`,
  });
  const label = 'สัญลักษณ์';
  text(label, x, textWidth(label));
  x += textWidth(label) + ITEM_GAP;
  for (const it of items) {
    const tw = textWidth(it.text);
    const sw = it.key ? 26 : SWATCH_W;
    if (x + sw + 6 + tw > b.x + Math.max(b.w, 400)) { x = b.x; y += SWATCH_H + 12; } // wrap
    if (it.swatch) {
      // shapes use the full swatch; dots (start/end) use their own small size
      const w = it.size ?? SWATCH_W, h = it.size ?? SWATCH_H;
      cells.vertex({ x: x + (SWATCH_W - w) / 2, y: y + (SWATCH_H - h) / 2, w, h, style: `html=1;${it.swatch}` });
    } else if (it.line) {
      // edge points are pre-margin, unlike vertex positions
      const ly = y + SWATCH_H / 2 - MARGIN;
      cells.edge({ pts: [[x - MARGIN, ly], [x + SWATCH_W - MARGIN, ly]], style: `html=1;${it.line}` });
    } else if (it.key) {
      cells.vertex({ value: it.key, x, y, w: sw, h: SWATCH_H, style: `text;html=1;align=center;verticalAlign=middle;${FONT_STYLE}fontSize=13;fontStyle=1;fontColor=${it.color};` });
    }
    text(it.text, x + sw + 6, tw);
    x += sw + 6 + tw + ITEM_GAP;
  }
  return true;
}

/** "S1 path:line" rows under the diagram, so a PNG keeps its sources without the tooltips. */
export function addSources(cells, th, sources) {
  const b = bounds(cells);
  const lines = ['ที่มา', ...sources.map((s) => `${s.tag} ${s.ref}`)];
  cells.vertex({
    value: lines.map(esc).join('<br>'), x: b.x, y: b.y + b.h + GAP, w: Math.max(b.w, ...lines.map(textWidth)), h: lines.length * SOURCE_ROW,
    style: `text;html=1;align=left;verticalAlign=top;whiteSpace=nowrap;${FONT_STYLE}fontSize=13;fontColor=${th.muted};`,
  });
}
