// Re-draw a converted page (the mxGraphModel that convert() writes) as a themed SVG in the
// house website style: rounded cards, hard offset shadows, colors by role, one clean line
// per connection. draw.io (Pele layout) only supplies positions; nothing here lays out.
import { unesc } from './svg.mjs';

export const SKIN_FONT = "'Anuphan','Sarabun',system-ui,sans-serif";
export const FONT_URL = 'https://fonts.googleapis.com/css2?family=Anuphan:wght@400;500;600;700&display=swap';

const INK = '#17212b', MUTED = '#56636f', LINE = '#3d4c5c', RULE = '#d3dde8', PAPER = '#ffffff';
const ROLES = {
  blue: { c: '#1d5fbf', s: '#dde8f8', m: '#aec6ec' },
  green: { c: '#0f6b4f', s: '#dcefe6', m: '#a3d1bf' },
  violet: { c: '#6a4bc4', s: '#e8e2f8', m: '#c8bbee' },
  orange: { c: '#b4540a', s: '#fdeadb', m: '#f3c8a3' },
  red: { c: '#b3261e', s: '#fbe3e1', m: '#f1b9b4' },
};
const ROLE_CYCLE = ['blue', 'green', 'violet', 'orange'];
const ACCENTS = { '#3598dc': ROLES.blue.c, '#eb6c36': ROLES.orange.c }; // theme accents -> house colors
const SHADOW = 4, PAD = 20;
const NEUTRAL_ROLE = 'blue';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n1 = (n) => Math.round(n * 10) / 10;

// ---------- parse the model back into cells ----------

const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], unesc(m[2])]));
const styleOf = (s = '') => {
  const st = {};
  for (const part of s.split(';')) {
    if (!part) continue;
    const i = part.indexOf('=');
    if (i < 0) st[part] = true, st._shape ??= part;
    else st[part.slice(0, i)] = part.slice(i + 1);
  }
  return st;
};

/** Cells of one mxGraphModel string, in document order, with absolute positions resolved. */
export function parseModel(model) {
  const cells = new Map();
  for (const m of model.matchAll(/<(mxCell|object)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
    const [, tag, rawAttrs, inner = ''] = m;
    const a = attrsOf(rawAttrs);
    let c;
    if (tag === 'object') {
      const cell = inner.match(/<mxCell\b([^>]*)>([\s\S]*?)<\/mxCell>/);
      if (!cell) continue;
      c = { ...attrsOf(cell[1]), id: a.id, value: a.label ?? '', data: { tooltip: a.tooltip, link: a.link, mermaid: a.mermaid }, geo: cell[2] };
    } else {
      if (!rawAttrs.includes('parent=')) continue; // the two root cells
      c = { ...a, data: {}, geo: inner };
    }
    const g = c.geo.match(/<mxGeometry\b([^>]*)/)?.[1] ?? '';
    const ga = attrsOf(g);
    const point = (as) => { const p = c.geo.match(new RegExp(`<mxPoint\\b([^>]*as="${as}"[^>]*)`))?.[1]; if (!p) return null; const q = attrsOf(p); return [+(q.x ?? 0), +(q.y ?? 0)]; };
    c.st = styleOf(c.style);
    c.vertex = c.vertex === '1';
    c.edge = c.edge === '1';
    c.box = { x: +(ga.x ?? 0), y: +(ga.y ?? 0), w: +(ga.width ?? 0), h: +(ga.height ?? 0) };
    c.rel = ga.relative === '1';
    c.relX = ga.x === undefined ? 0 : +ga.x;
    c.sp = point('sourcePoint');
    c.tp = point('targetPoint');
    c.offset = point('offset') ?? [0, 0];
    c.via = [...(c.geo.match(/<Array as="points">([\s\S]*?)<\/Array>/)?.[1] ?? '').matchAll(/<mxPoint\b([^>]*)\/>/g)].map((p) => { const q = attrsOf(p[1]); return [+q.x, +q.y]; });
    cells.set(c.id, c);
  }
  // absolute origin of a cell's parent (the page layer "1" sits at 0,0)
  const origin = (c) => {
    if (c._o) return c._o;
    const p = cells.get(c.parent);
    if (!p || p.edge) return (c._o = [0, 0]);
    const po = origin(p);
    return (c._o = [po[0] + p.box.x, po[1] + p.box.y]);
  };
  for (const c of cells.values()) {
    const o = origin(c);
    if (c.vertex && !cells.get(c.parent)?.edge) c.abs = { x: o[0] + c.box.x, y: o[1] + c.box.y, w: c.box.w, h: c.box.h };
    if (c.edge) {
      const move = (p) => p && [p[0] + o[0], p[1] + o[1]];
      c.sp = move(c.sp); c.tp = move(c.tp); c.via = c.via.map(move);
    }
  }
  return cells;
}

// ---------- text ----------

const plain = (s) => unesc(String(s).replace(/<[^>]+>/g, ''));
/** Lines of a draw.io html label; a line that came from a <span> is kept as "small". */
function linesOf(value) {
  return String(value ?? '').split(/<br\s*\/?>/i).map((raw) => ({ t: plain(raw), small: /<span/.test(raw) })).filter((l) => l.t.trim() || String(value).includes('<br'));
}
// Thai marks above and below a letter add no width
const MARK = /[ัิ-ฺ็-๎]/;
export function textWidth(t, size, bold = false) {
  let w = 0;
  for (const ch of t) {
    if (MARK.test(ch)) continue;
    w += /[฀-๿]/.test(ch) ? 0.5 : /[A-Z0-9@#%&]/.test(ch) ? 0.64 : /\s/.test(ch) ? 0.28 : /[ilI.,:;|!'()]/.test(ch) ? 0.3 : /[mwMW]/.test(ch) ? 0.85 : 0.54;
  }
  return w * size * (bold ? 1.06 : 1);
}

function textEl({ x, y, lines, size = 14, color = INK, bold = false, anchor = 'middle', lh = 1.4, fitW, rotate }) {
  if (!lines.length) return '';
  let s = size;
  if (fitW) { // squeeze a line that would run out of its box (Anuphan is wider than the font Pele measured)
    const widest = Math.max(...lines.map((l) => textWidth(l.t, s, bold)));
    if (widest > fitW) s = Math.max(10.5, s * (fitW / widest));
  }
  const step = s * lh;
  const first = y - ((lines.length - 1) * step) / 2;
  const tsp = lines.map((l, i) => {
    const ls = l.small ? Math.min(s, 12) : s;
    return `<tspan x="${n1(x)}" y="${n1(first + i * step)}"${l.small ? ` font-size="${ls}" fill="${MUTED}" font-weight="400"` : ''}>${esc(l.t)}</tspan>`;
  }).join('');
  const tr = rotate ? ` transform="rotate(${rotate} ${n1(x)} ${n1(y)})"` : '';
  return `<text text-anchor="${anchor}" dominant-baseline="central" font-size="${n1(s)}" fill="${color}"${bold ? ' font-weight="600"' : ''}${tr}>${tsp}</text>`;
}

// ---------- colors ----------

const lum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c ?? '');
const house = (hex, th) => (hex === th?.ink ? INK : hex === th?.muted ? MUTED : ACCENTS[hex?.toLowerCase()] ?? hex);

// ---------- shapes ----------

/** Outline of a vertex as svg element(s), given fill/stroke attrs. Returns [markup, hasOutline]. */
function outline(c, b, attrs, th) {
  const st = c.st, sh = st.shape ?? st._shape ?? '';
  const { x, y, w, h } = b;
  // house look: every rounded box gets a generous corner, pills stay pills
  const pill = st.arcSize && +st.arcSize >= 30 && st.absoluteArcSize !== '1';
  const arc = st.rounded === '1' ? (pill ? Math.min(w, h) / 2 : Math.min(12, Math.min(w, h) / 2)) : 4;
  if (sh === 'rhombus') return `<polygon points="${n1(x + w / 2)},${n1(y)} ${n1(x + w)},${n1(y + h / 2)} ${n1(x + w / 2)},${n1(y + h)} ${n1(x)},${n1(y + h / 2)}" stroke-linejoin="round" ${attrs}/>`;
  if (sh === 'ellipse' || sh === 'endState') return `<ellipse cx="${n1(x + w / 2)}" cy="${n1(y + h / 2)}" rx="${n1(w / 2)}" ry="${n1(h / 2)}" ${attrs}/>`;
  if (sh === 'cylinder3') {
    const e = Math.min(h * 0.18, 12);
    return `<path d="M${x},${y + e} A${w / 2},${e} 0 0 1 ${x + w},${y + e} V${y + h - e} A${w / 2},${e} 0 0 1 ${x},${y + h - e} Z" ${attrs}/>` +
      `<path d="M${x},${y + e} A${w / 2},${e} 0 0 0 ${x + w},${y + e}" fill="none" stroke="${INK}" stroke-width="1.5"/>`;
  }
  if (sh === 'hexagon') { const k = w * 0.15; return `<polygon points="${x + k},${y} ${x + w - k},${y} ${x + w},${y + h / 2} ${x + w - k},${y + h} ${x + k},${y + h} ${x},${y + h / 2}" stroke-linejoin="round" ${attrs}/>`; }
  if (sh === 'parallelogram') { const k = Math.min(w * 0.15, 22); return `<polygon points="${x + k},${y} ${x + w},${y} ${x + w - k},${y + h} ${x},${y + h}" stroke-linejoin="round" ${attrs}/>`; }
  if (sh === 'process') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ${attrs}/><path d="M${x + 10},${y} V${y + h} M${x + w - 10},${y} V${y + h}" stroke="${INK}" stroke-width="1.5" fill="none"/>`;
  if (sh === 'note') { const k = 12; return `<path d="M${x},${y} H${x + w - k} L${x + w},${y + k} V${y + h} H${x} Z" stroke-linejoin="round" ${attrs}/><path d="M${x + w - k},${y} V${y + k} H${x + w}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`; }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${n1(arc)}" ${attrs}/>`;
}

/** The look of one ordinary node: fill, border, shadow color, text color. */
function nodeLook(c, th, role) {
  const st = c.st;
  const fill = st.fillColor, none = !fill || fill === 'none';
  const r = ROLES[role];
  if (st.strokeColor === 'none' && !none) return { fill: house(fill, th), stroke: 'none', text: lum(fill) < 0.5 ? '#fff' : INK, plain: true };
  if (st._shape === 'ellipse' && st.shape !== 'endState' && fill === th.ink) return { fill: INK, stroke: 'none', text: '#fff', plain: true };
  if (st.shape === 'endState') return { fill: INK, stroke: INK, text: '#fff', plain: true, ring: true };
  if (st._shape === 'rhombus') return { fill: ROLES.orange.s, stroke: ROLES.orange.c, text: INK, shadowColor: ROLES.orange.m };
  if (st.dashed === '1') return { fill: ROLES.red.s, stroke: ROLES.red.c, text: INK, dash: '6 4', shadowColor: ROLES.red.m };
  if (!none && fill.toLowerCase() !== th.node.toLowerCase()) {
    const f = house(fill, th);
    return { fill: f, stroke: INK, text: lum(f) < 0.55 ? '#fff' : INK, shadowColor: r.m };
  }
  return { fill: PAPER, stroke: INK, text: INK, shadowColor: r.m };
}

// ---------- routing ----------

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out.at(-1);
    if (q && Math.abs(p[0] - q[0]) < 0.5 && Math.abs(p[1] - q[1]) < 0.5) continue;
    out.push(p);
  }
  // drop middle points on a straight run
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1], b = out[i + 1];
    return !((Math.abs(a[0] - p[0]) < 0.5 && Math.abs(p[0] - b[0]) < 0.5) || (Math.abs(a[1] - p[1]) < 0.5 && Math.abs(p[1] - b[1]) < 0.5));
  });
}

function pinPoint(cell, kind) {
  const st = cell.st, k = kind === 'exit' ? 'exit' : 'entry';
  const fx = st[`${k}X`], fy = st[`${k}Y`];
  return fx === undefined ? null : { fx: +fx, fy: +fy };
}

/** Points of an edge. draw.io-routed lines (no waypoints, orthogonal style) are routed here instead. */
function routeOf(e, cells) {
  const s = cells.get(e.source), t = cells.get(e.target);
  const auto = e.st.edgeStyle === 'orthogonalEdgeStyle' && !e.via.length && s?.abs && t?.abs;
  if (!auto) return dedupe([e.sp, ...e.via, e.tp].filter(Boolean));
  const ps = pinPoint(e, 'exit'), pt = pinPoint(e, 'entry');
  const at = (b, p) => [b.x + b.w * p.fx, b.y + b.h * p.fy];
  const a = ps ? at(s.abs, ps) : [s.abs.x + s.abs.w, s.abs.y + s.abs.h / 2];
  const z = pt ? at(t.abs, pt) : [t.abs.x, t.abs.y + t.abs.h / 2];
  const horiz = (p) => p && (p.fx === 0 || p.fx === 1);
  const mid = [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2];
  if (horiz(ps) && horiz(pt)) return dedupe([a, [mid[0], a[1]], [mid[0], z[1]], z]);
  if (!horiz(ps) && !horiz(pt)) return dedupe([a, [a[0], mid[1]], [z[0], mid[1]], z]);
  return dedupe(horiz(ps) ? [a, [z[0], a[1]], z] : [a, [a[0], z[1]], z]);
}

function roundedPath(pts, r = 10) {
  if (pts.length < 2) return '';
  let d = `M${n1(pts[0][0])},${n1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], p = pts[i], b = pts[i + 1];
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]), l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const k = Math.min(r, l1 / 2, l2 / 2);
    const p1 = [p[0] - ((p[0] - a[0]) / l1) * k, p[1] - ((p[1] - a[1]) / l1) * k];
    const p2 = [p[0] + ((b[0] - p[0]) / l2) * k, p[1] + ((b[1] - p[1]) / l2) * k];
    d += ` L${n1(p1[0])},${n1(p1[1])} Q${n1(p[0])},${n1(p[1])} ${n1(p2[0])},${n1(p2[1])}`;
  }
  return `${d} L${n1(pts.at(-1)[0])},${n1(pts.at(-1)[1])}`;
}

function pointAt(pts, frac) {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let want = lens.reduce((a, b) => a + b, 0) * frac;
  for (let i = 0; i < lens.length; i++) {
    if (want <= lens[i] || i === lens.length - 1) {
      const t = lens[i] ? Math.min(1, want / lens[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    want -= lens[i];
  }
  return pts[0];
}

// ---------- arrowheads ----------

/** An end marker at `p`; `u` is the unit vector of the line running into that end. */
function marker(kind, filled, p, u, color) {
  const n = [-u[1], u[0]];
  const at = (d, o = 0) => [p[0] - u[0] * d + n[0] * o, p[1] - u[1] * d + n[1] * o];
  const f = (q) => `${n1(q[0])},${n1(q[1])}`;
  const ln = (a, b) => `<path d="M${f(a)} L${f(b)}" stroke="${color}" stroke-width="1.6" stroke-linecap="round" fill="none"/>`;
  const dot = (d, r) => { const c = at(d); return `<circle cx="${n1(c[0])}" cy="${n1(c[1])}" r="${r}" fill="${PAPER}" stroke="${color}" stroke-width="1.6"/>`; };
  const foot = (d) => ln(at(d), at(0, 7)) + ln(at(d), at(0, -7)) + ln(at(d), at(0));
  const bar = (d) => ln(at(d, 7), at(d, -7));
  switch (kind) {
    case 'block': return `<polygon points="${f(p)} ${f(at(11, 5.5))} ${f(at(11, -5.5))}" fill="${filled ? color : PAPER}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
    case 'diamondThin': return `<polygon points="${f(p)} ${f(at(8, 5))} ${f(at(16))} ${f(at(8, -5))}" fill="${filled ? color : PAPER}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
    case 'oval': return dot(6, 5);
    case 'ERmandOne': return bar(8) + bar(14);
    case 'ERzeroToOne': return bar(8) + dot(18, 5);
    case 'ERoneToMany': return foot(14) + bar(18);
    case 'ERzeroToMany': return foot(14) + dot(23, 5);
    default: return '';
  }
}
const MARKER_LEN = { block: 11, diamondThin: 16, oval: 11 };

// ---------- the page ----------

/**
 * One converted page -> { svg, width, height, title }. `uid` keeps ids unique when several
 * SVGs sit in one HTML page. `inline` leaves out the XML header and the font import.
 */
export function skinPage(page, { th, uid = 's', inline = false, dropTitle = false } = {}) {
  const cells = parseModel(page.model);
  const all = [...cells.values()];
  const verts = all.filter((c) => c.vertex && c.abs);
  const edges = all.filter((c) => c.edge);
  const childOf = (id) => verts.filter((c) => c.parent === id);

  // title text cell (--title): the HTML page shows it as a heading instead
  const titleCell = verts.find((c) => c.st._shape === 'text' && c.st.fontSize === '20' && c.st.fontStyle === '1');
  const skip = new Set(dropTitle && titleCell ? [titleCell.id] : []);

  // roles: each top-level container takes the next color; everything inside inherits it
  const containers = verts.filter((c) => c.st.container === '1' && !c.st.shape?.startsWith('table'));
  const roleOf = new Map();
  let next = 0;
  const topOf = (c) => { let p = cells.get(c.parent); let top = null; while (p && p.vertex) { if (containers.includes(p)) top = p; p = cells.get(p.parent); } return top; };
  for (const c of containers) {
    const top = topOf(c);
    if (!top) roleOf.set(c.id, ROLE_CYCLE[next++ % ROLE_CYCLE.length]);
  }
  const roleFor = (c) => {
    const own = containers.includes(c) && !topOf(c) ? c : topOf(c);
    return own ? roleOf.get(own.id) : NEUTRAL_ROLE;
  };

  const layers = { frame: [], shape: [], edge: [], text: [] };
  const defs = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y, w = 0, h = 0, extra = 0) => { minX = Math.min(minX, x - extra); minY = Math.min(minY, y - extra); maxX = Math.max(maxX, x + w + extra); maxY = Math.max(maxY, y + h + extra); };

  // sequence lifelines take their colors in left-to-right order
  const lifelines = verts.filter((c) => c.st.shape === 'umlLifeline').sort((a, b) => a.abs.x - b.abs.x);

  for (const c of verts) {
    if (skip.has(c.id) || cells.get(c.parent)?.st.shape === 'tableRow' || cells.get(c.parent)?.st.shape === 'table' || cells.get(c.parent)?.st._shape === 'swimlane') continue;
    const b = c.abs, st = c.st, sh = st.shape ?? st._shape ?? '';
    const lines = linesOf(c.value);
    const size = +(st.fontSize ?? 14), bold = (+(st.fontStyle ?? 0) & 1) === 1;
    const link = c.data?.link;
    const wrap = (s) => (link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${s}</a>` : s);
    const tip = c.data?.tooltip ? `<title>${esc(c.data.tooltip)}</title>` : '';

    if (sh === 'image') { // a diagram type with no native shapes: Pele's own SVG, re-colored and inlined so the page font applies
      const raw = Buffer.from(st.image.replace(/^data:image\/svg\+xml,/, ''), 'base64').toString('utf8');
      const set = { 'pele-bg': '#ffffff', 'pele-fg': INK, 'pele-muted': MUTED, 'pele-line': LINE, 'pele-surface': '#ffffff', 'pele-surface-alt': '#f5f8fb', 'pele-border': RULE,
        'pele-accent': ROLES.blue.c, 'pele-font': SKIN_FONT.replace(/'/g, ''), 'pele-series-1': ROLES.blue.c, 'pele-series-2': ROLES.green.c, 'pele-series-3': ROLES.violet.c, 'pele-series-4': ROLES.orange.c };
      let themed = raw;
      for (const [k, v] of Object.entries(set)) themed = themed.replace(new RegExp(`--${k}:[^;"]+`), `--${k}:${v}`);
      themed = themed.replace(/<svg\b([^>]*)>/, (_, a) => `<svg x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${n1(b.h)}" ${a.replace(/\s(width|height)="[^"]*"/g, '')}>`);
      layers.shape.push(themed);
      grow(b.x, b.y, b.w, b.h);
      continue;
    }
    if (sh === 'text') { // free text (titles, axis labels, legend words, source list)
      const vertical = st.horizontal === '0';
      const color = house(st.fontColor ?? INK, th);
      const anchor = st.align === 'left' ? 'start' : st.align === 'right' ? 'end' : 'middle';
      const tx = anchor === 'start' ? b.x + (+(st.spacingLeft ?? 0)) : anchor === 'end' ? b.x + b.w : b.x + b.w / 2;
      layers.text.push(textEl({ x: tx, y: b.y + b.h / 2, lines, size, color, bold, anchor, rotate: vertical ? -90 : 0 }));
      const tw = Math.max(...lines.map((l) => textWidth(l.t, size, bold)), 0);
      grow(anchor === 'start' ? b.x : anchor === 'end' ? b.x + b.w - tw : b.x + b.w / 2 - tw / 2, b.y, tw, b.h);
      continue;
    }
    if (sh === 'umlLifeline') {
      const role = ROLE_CYCLE[lifelines.indexOf(c) % ROLE_CYCLE.length], r = ROLES[role];
      const head = +(st.size ?? 40), cx = b.x + b.w / 2;
      layers.shape.push(`<path d="M${n1(cx)},${n1(b.y + head)} V${n1(b.y + b.h)}" stroke="${r.c}" stroke-width="1.5" stroke-dasharray="6 5" opacity=".55" fill="none"/>`);
      layers.shape.push(`<rect x="${n1(b.x + SHADOW)}" y="${n1(b.y + SHADOW)}" width="${n1(b.w)}" height="${head}" rx="10" fill="${r.m}"/>` +
        `<rect x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${head}" rx="10" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>` +
        `<rect x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${head}" rx="10" fill="${r.s}" opacity=".5"/>`);
      layers.text.push(textEl({ x: cx, y: b.y + head / 2, lines, size, bold: true, fitW: b.w - 14 }));
      grow(b.x, b.y, b.w + SHADOW, b.h);
      continue;
    }
    if (sh === 'umlFrame') {
      const tw = +(st.width ?? 40), th2 = +(st.height ?? 22);
      layers.frame.push(`<rect x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${n1(b.h)}" rx="6" fill="none" stroke="${MUTED}" stroke-width="1.2" stroke-dasharray="3 4"/>` +
        `<path d="M${n1(b.x)},${n1(b.y)} H${n1(b.x + tw + 14)} V${n1(b.y + th2 - 6)} L${n1(b.x + tw + 6)},${n1(b.y + th2 + 2)} H${n1(b.x)} Z" fill="${ROLES.violet.s}" stroke="${ROLES.violet.c}" stroke-width="1.2" stroke-linejoin="round"/>`);
      layers.text.push(textEl({ x: b.x + (tw + 6) / 2 + 2, y: b.y + th2 / 2 + 1, lines, size: 12, color: ROLES.violet.c, bold: true }));
      grow(b.x, b.y, b.w, b.h);
      continue;
    }
    if (sh === 'table' || sh === 'swimlane') {
      grow(b.x, b.y, b.w + SHADOW, b.h + SHADOW);
      layers.shape.push(sh === 'table' ? tableMarkup(c, cells, th, b) : boxMarkup(c, cells, th, b, roleFor(c)));
      continue;
    }
    if (sh === 'line') continue;
    if (c.st.container === '1') { // subgraph / composite state: tinted area, dashed edge, title as a pill
      const role = ROLES[roleFor(c)];
      const custom = isHex(st.strokeColor) && st.strokeColor.toLowerCase() !== th.border.toLowerCase();
      const col = custom ? house(st.strokeColor, th) : role.c;
      const soft = isHex(st.fillColor) && st.fillColor.toLowerCase() !== th.alt.toLowerCase() ? house(st.fillColor, th) : role.s;
      layers.frame.push(`<rect x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${n1(b.h)}" rx="14" fill="${soft}" fill-opacity=".55" stroke="${col}" stroke-width="1.5" stroke-dasharray="${st.dashed === '1' ? '2 4' : '7 5'}"/>`);
      const label = lines.map((l) => l.t).join(' ');
      if (label) {
        const pw = Math.min(textWidth(label, 13, true) + 24, b.w - 20);
        layers.text.push(`<rect x="${n1(b.x + 12)}" y="${n1(b.y + 9)}" width="${n1(pw)}" height="26" rx="13" fill="${PAPER}" stroke="${col}" stroke-width="1.5"/>` +
          textEl({ x: b.x + 12 + pw / 2, y: b.y + 22, lines: [{ t: label }], size: 13, color: col, bold: true, fitW: pw - 18 }));
      }
      grow(b.x, b.y, b.w, b.h);
      continue;
    }

    // ordinary node
    const look = nodeLook(c, th, roleFor(c));
    const small = b.h < 26 || b.w < 14;
    const attrs = `fill="${look.fill}" stroke="${look.stroke}" stroke-width="1.5"${look.dash ? ` stroke-dasharray="${look.dash}"` : ''}`;
    let g = '';
    if (!look.plain && !small && look.shadowColor) g += outline(c, { ...b, x: b.x + SHADOW, y: b.y + SHADOW }, `fill="${look.shadowColor}" stroke="none"`, th);
    g += outline(c, b, look.ring ? `fill="${PAPER}" stroke="${INK}" stroke-width="1.5"` : attrs, th);
    if (look.ring) g += `<ellipse cx="${n1(b.x + b.w / 2)}" cy="${n1(b.y + b.h / 2)}" rx="${n1(b.w / 2 - 4)}" ry="${n1(b.h / 2 - 4)}" fill="${INK}"/>`;
    const label = textEl({ x: b.x + b.w / 2, y: b.y + b.h / 2, lines, size, color: look.text, bold: look.fill !== PAPER && lum(look.fill) < 0.5 || bold, fitW: b.w - (sh === 'rhombus' ? b.w * 0.42 : 18) });
    layers.shape.push(wrap(`<g>${tip}${g}${label}</g>`));
    grow(b.x, b.y, b.w + (look.plain || small ? 0 : SHADOW), b.h + (look.plain || small ? 0 : SHADOW));
  }

  // edges: one clean line each; a pair running both ways becomes one line with two heads
  const drawn = [];
  const keyOf = (e) => `${e.source ?? ''}\n${e.target ?? ''}\n${plain(e.value)}`;
  const seen = new Set();
  for (const e of edges) {
    if (skip.has(e.id)) continue;
    const pts = routeOf(e, cells);
    if (pts.length < 2) continue;
    const k = keyOf(e);
    if (e.source && e.target) { // the same connection written twice: draw it once
      if (seen.has(k)) continue;
      seen.add(k);
    }
    const back = e.source && e.target ? drawn.find((d) => d.e.source === e.target && d.e.target === e.source && !plain(d.e.value) && !plain(e.value) && sameLook(d.e, e)) : null;
    if (back) { back.both = true; continue; }
    drawn.push({ e, pts, both: false });
  }
  function sameLook(a, b) { return (a.st.dashed ?? '') === (b.st.dashed ?? '') && a.st.endArrow === b.st.endArrow; }

  for (const { e, pts, both } of drawn) {
    const st = e.st;
    const accent = isHex(st.strokeColor) && st.strokeColor.toLowerCase() === th.accent.toLowerCase();
    const free = st.endArrow === 'none' && isHex(st.strokeColor) && !e.source && !e.target; // chart lines, dividers
    const color = accent ? ROLES[NEUTRAL_ROLE].c : free ? house(st.strokeColor, th) : (st.strokeColor === th.muted || st.strokeColor === th.link || !isHex(st.strokeColor)) ? LINE : house(st.strokeColor, th);
    const width = accent ? 2.6 : free ? +(st.strokeWidth ?? 1) : 1.7;
    const dash = st.dashed === '1' ? ' stroke-dasharray="6 5"' : '';
    // pull the line back under an open or large marker so it does not poke through
    const endK = st.endArrow ?? 'none', startK = both ? endK : st.startArrow ?? 'none';
    const trim = (p, q, len) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [q[0] - ((q[0] - p[0]) / L) * len, q[1] - ((q[1] - p[1]) / L) * len]; };
    const line = pts.map((p) => [...p]);
    const unit = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
    const uEnd = unit(pts.at(-2), pts.at(-1)), uStart = unit(pts[1], pts[0]);
    const endFill = st.endFill !== '0', startFill = both ? endFill : st.startFill !== '0';
    if (MARKER_LEN[endK] && endK !== 'oval') line[line.length - 1] = trim(line.at(-2), line.at(-1), MARKER_LEN[endK] - 2);
    if (MARKER_LEN[startK] && startK !== 'oval') line[0] = trim(line[1], line[0], MARKER_LEN[startK] - 2);
    let g = `<path d="${roundedPath(line.length > 1 ? dedupe(line) : pts)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`;
    g += marker(endK, endFill, pts.at(-1), uEnd, color) + marker(startK, startFill, pts[0], uStart, color);
    layers.edge.push(g);
    for (const p of pts) grow(p[0], p[1], 0, 0, 2);
    // the line's own label, and labels riding on it (class diagram cardinalities)
    const labels = [];
    if (plain(e.value)) labels.push({ text: plain(e.value), frac: (e.relX + 1) / 2, off: e.offset, own: true });
    for (const t of verts.length ? all.filter((x) => x.vertex && x.parent === e.id) : []) labels.push({ text: plain(t.value), frac: (t.relX + 1) / 2, off: t.offset });
    for (const l of labels) {
      const auto = l.own && !e.via.length && e.st.edgeStyle === 'orthogonalEdgeStyle';
      const p = pointAt(pts, auto ? 0.5 : l.frac);
      const cx = p[0] + (auto ? 0 : l.off[0]), cy = p[1] + (auto ? 0 : l.off[1]);
      const w = textWidth(l.text, 12.5) + 18;
      layers.text.push(`<rect x="${n1(cx - w / 2)}" y="${n1(cy - 11)}" width="${n1(w)}" height="22" rx="11" fill="${PAPER}" stroke="${RULE}" stroke-width="1.2"/>` +
        textEl({ x: cx, y: cy + 0.5, lines: [{ t: l.text }], size: 12.5, color: MUTED }));
      grow(cx - w / 2, cy - 11, w, 22);
    }
  }

  const width = Math.ceil(maxX - minX + PAD * 2), height = Math.ceil(maxY - minY + PAD * 2);
  const body = [...layers.frame, ...layers.shape, ...layers.edge, ...layers.text].join('\n');
  const svg = `${inline ? '' : '<?xml version="1.0" encoding="UTF-8"?>\n'}<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n1(minX - PAD)} ${n1(minY - PAD)} ${width} ${height}" width="${width}" height="${height}" font-family="${SKIN_FONT}" role="img" aria-label="${esc(page.title ?? page.name ?? 'diagram')}">` +
    (inline ? '' : `<style>@import url('${esc(FONT_URL)}');</style>`) +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') + `<g id="${uid}">\n${body}\n</g></svg>`;
  return { svg, width, height, title: titleCell ? plain(titleCell.value) : null };
}

// ---------- boxes with rows (class) and tables (ER) ----------

/** UML class box: header, attribute rows, divider, method rows. */
function boxMarkup(c, cells, th, b, role) {
  const st = c.st, r = ROLES[role];
  const head = +(st.startSize ?? 28);
  const rows = [...cells.values()].filter((x) => x.parent === c.id);
  let g = `<rect x="${n1(b.x + SHADOW)}" y="${n1(b.y + SHADOW)}" width="${n1(b.w)}" height="${n1(b.h)}" rx="10" fill="${r.m}"/>` +
    `<rect x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${n1(b.h)}" rx="10" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>` +
    `<path d="M${n1(b.x)},${n1(b.y + head)} V${n1(b.y + 10)} Q${n1(b.x)},${n1(b.y)} ${n1(b.x + 10)},${n1(b.y)} H${n1(b.x + b.w - 10)} Q${n1(b.x + b.w)},${n1(b.y)} ${n1(b.x + b.w)},${n1(b.y + 10)} V${n1(b.y + head)} Z" fill="${r.s}" stroke="${INK}" stroke-width="1.5"/>`;
  g += textEl({ x: b.x + b.w / 2, y: b.y + head / 2, lines: linesOf(c.value), size: 14, bold: true, fitW: b.w - 14 });
  for (const row of rows) {
    const rb = { x: b.x, y: b.y + row.box.y, w: b.w, h: row.box.h };
    if (row.st._shape === 'line') { g += `<path d="M${n1(b.x)},${n1(rb.y + rb.h / 2)} H${n1(b.x + b.w)}" stroke="${INK}" stroke-width="1.5"/>`; continue; }
    const lines = linesOf(row.value);
    if (lines.some((l) => l.t)) g += textEl({ x: b.x + 12, y: rb.y + rb.h / 2, lines, size: 13, anchor: 'start', fitW: b.w - 20 });
  }
  return g;
}

/** ER table: colored header, then key | name | type columns. */
function tableMarkup(c, cells, th, b) {
  const head = +(c.st.startSize ?? 30);
  const focal = c.st.fillColor && c.st.fillColor.toLowerCase() === th.accent.toLowerCase();
  const headFill = focal ? ROLES.blue.c : INK;
  const rows = [...cells.values()].filter((x) => x.parent === c.id && x.st.shape === 'tableRow').sort((p, q) => p.box.y - q.box.y);
  let g = `<rect x="${n1(b.x + SHADOW)}" y="${n1(b.y + SHADOW)}" width="${n1(b.w)}" height="${n1(b.h)}" rx="10" fill="${focal ? ROLES.blue.m : ROLES.violet.m}"/>` +
    `<rect x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${n1(b.h)}" rx="10" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>` +
    `<path d="M${n1(b.x)},${n1(b.y + head)} V${n1(b.y + 10)} Q${n1(b.x)},${n1(b.y)} ${n1(b.x + 10)},${n1(b.y)} H${n1(b.x + b.w - 10)} Q${n1(b.x + b.w)},${n1(b.y)} ${n1(b.x + b.w)},${n1(b.y + 10)} V${n1(b.y + head)} Z" fill="${headFill}" stroke="${INK}" stroke-width="1.5"/>`;
  g += textEl({ x: b.x + b.w / 2, y: b.y + head / 2, lines: linesOf(c.value), size: 14, color: '#fff', bold: true, fitW: b.w - 14 });
  rows.forEach((row, i) => {
    const y = b.y + row.box.y, h = row.box.h;
    if (i % 2) g += `<rect x="${n1(b.x + 1)}" y="${n1(y)}" width="${n1(b.w - 2)}" height="${n1(h)}" fill="#f5f8fb"/>`;
    if (i > 0) g += `<path d="M${n1(b.x)},${n1(y)} H${n1(b.x + b.w)}" stroke="${RULE}" stroke-width="1"/>`;
    const cols = [...cells.values()].filter((x) => x.parent === row.id).sort((p, q) => p.box.x - q.box.x);
    cols.forEach((col, k) => {
      const cx = b.x + col.box.x, v = plain(col.value);
      const color = k === 0 ? (v.includes('PK') ? ROLES.blue.c : ROLES.violet.c) : k === 2 ? MUTED : INK;
      if (k === 0) g += textEl({ x: cx + col.box.w / 2, y: y + h / 2, lines: [{ t: v }], size: 12.5, color, bold: true });
      else g += textEl({ x: cx + 8, y: y + h / 2, lines: [{ t: v }], size: 13, color, anchor: 'start', fitW: col.box.w - 12 });
      if (k < 2) g += `<path d="M${n1(cx + col.box.w)},${n1(y)} V${n1(y + h)}" stroke="${RULE}" stroke-width="1"/>`;
    });
  });
  return g;
}
