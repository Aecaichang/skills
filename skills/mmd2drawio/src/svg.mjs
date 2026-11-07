// Read node and edge geometry out of Pele's SVG output.
// Class names and structure are pinned to pele@1.9.0; re-run the tests after upgrading.

const HIT_PAD = 14; // how far an edge endpoint may sit outside a node box
const SNAP = 6; // px; smaller x/y differences between route points are treated as straight

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
export const nums = (s) => (s?.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
export const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
export const cssProp = (style, prop) => style?.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))?.[1]?.trim();

/** Top-level <g> groups whose class starts with `cls` (a regex fragment). */
export function groups(svg, cls) {
  const out = [];
  const re = new RegExp(`<g class="${cls}[^"]*"[^>]*>`, 'g');
  let m;
  while ((m = re.exec(svg))) {
    let depth = 1, t;
    const tagRe = /<\/?g\b[^>]*>/g;
    tagRe.lastIndex = re.lastIndex;
    while (depth && (t = tagRe.exec(svg))) depth += t[0].startsWith('</') ? -1 : 1;
    out.push({ open: m[0], body: svg.slice(re.lastIndex, t.index) });
  }
  return out;
}

export function labelOf(body) {
  const spans = [...body.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((s) => unesc(s[1]));
  if (spans.length) return spans;
  const t = body.match(/<text[^>]*>([^<]*)<\/text>/);
  return t ? [unesc(t[1])] : [];
}

/**
 * Turn a Pele path (M/L/H/V/C) into a polyline. Pele draws bends as S-curves whose
 * two control points are the elbows of an orthogonal route, so they become points.
 */
export function polyline(d) {
  const pts = [];
  for (const [, cmd, args] of d.matchAll(/([MLHVCQA])([^MLHVCQAZ]*)/g)) {
    const n = nums(args);
    if (cmd === 'H') n.forEach((x) => pts.push([x, pts.at(-1)[1]]));
    else if (cmd === 'V') n.forEach((y) => pts.push([pts.at(-1)[0], y]));
    // rounded corner arcs (rx ry rotation large-arc sweep x y): keep only the end point
    else if (cmd === 'A') for (let i = 0; i + 6 < n.length; i += 7) pts.push([n[i + 5], n[i + 6]]);
    else for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]);
  }
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][0] - pts[i - 1][0]) < SNAP) pts[i][0] = pts[i - 1][0];
    if (Math.abs(pts[i][1] - pts[i - 1][1]) < SNAP) pts[i][1] = pts[i - 1][1];
  }
  return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
}

/** The node whose box contains (or nearly touches) the point. */
export function nodeAt([px, py], nodes) {
  let best = null, bestD = Infinity;
  for (const n of nodes) {
    const dx = Math.max(n.x - px, 0, px - (n.x + n.w));
    const dy = Math.max(n.y - py, 0, py - (n.y + n.h));
    const d = Math.hypot(dx, dy);
    if (d < bestD) [best, bestD] = [n, d];
  }
  return bestD <= HIT_PAD ? best : null;
}

/** The frame whose border the point sits on: Pele ends a line to a subgraph at its border. */
function frameAt([px, py], frames) {
  const gap = (f) => {
    const dx = Math.max(f.x - px, 0, px - (f.x + f.w)), dy = Math.max(f.y - py, 0, py - (f.y + f.h));
    return dx || dy ? Math.hypot(dx, dy) : Math.min(px - f.x, f.x + f.w - px, py - f.y, f.y + f.h - py);
  };
  const best = frames.reduce((a, b) => (a && gap(a) <= gap(b) ? a : b), null);
  return best && gap(best) <= HIT_PAD ? best : null;
}

/** Where a point projects onto a polyline: fraction along it (0..1) and the offset. */
export function project(pts, [px, py]) {
  const segs = pts.slice(1).map((p, i) => [pts[i], p]);
  const lens = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  let best = { d: Infinity, frac: 0.5, off: [0, 0] }, run = 0;
  segs.forEach(([a, b], i) => {
    const L = lens[i] || 1;
    const t = Math.min(1, Math.max(0, ((px - a[0]) * (b[0] - a[0]) + (py - a[1]) * (b[1] - a[1])) / (L * L)));
    const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const d = Math.hypot(px - q[0], py - q[1]);
    if (d < best.d) best = { d, frac: (run + t * L) / total, off: [px - q[0], py - q[1]] };
    run += L;
  });
  return best;
}

/**
 * Bounding box of a node outline (M/L/H/V/A, relative q/t). Pele's arcs are close to half
 * ellipses, so an arc spans its radii around its chord's middle; q/t waves count by end point.
 */
function outlineBox(d) {
  const xs = [], ys = [];
  let x = 0, y = 0;
  const go = (px, py) => { xs.push(x = px); ys.push(y = py); };
  for (const [, cmd, args] of d.matchAll(/([MLHVAqt])([^a-zA-Z]*)/g)) {
    const n = nums(args);
    if (cmd === 'H') go(n[0], y);
    else if (cmd === 'V') go(x, n[0]);
    else if (cmd === 'q' || cmd === 't') go(x + n.at(-2), y + n.at(-1));
    else if (cmd === 'A') {
      const [rx, ry, , , , ex, ey] = n;
      const mx = (x + ex) / 2, my = (y + ey) / 2;
      xs.push(mx - rx, mx + rx);
      ys.push(my - ry, my + ry);
      go(ex, ey);
    } else go(n[0], n[1]);
  }
  const left = Math.min(...xs), top = Math.min(...ys);
  return [left, top, Math.max(...xs) - left, Math.max(...ys) - top];
}

export function readNodes(svg) {
  return groups(svg, 'pele-node(?=[ "])').map(({ open, body }) => {
    const cls = attr(open, 'class');
    const [cx = 0, cy = 0] = nums(attr(open, 'transform'));
    const shapeTag = body.match(/<(rect|polygon|circle|path)\b[^>]*>/)?.[0] ?? '';
    let x, y, w, h;
    if (shapeTag.startsWith('<rect')) {
      [w, h] = [+attr(shapeTag, 'width'), +attr(shapeTag, 'height')];
      [x, y] = [cx + +(attr(shapeTag, 'x') ?? -w / 2), cy + +(attr(shapeTag, 'y') ?? -h / 2)];
    } else if (shapeTag.startsWith('<path')) {
      const [left, top, bw, bh] = outlineBox(attr(shapeTag, 'd'));
      [x, y, w, h] = [cx + left, cy + top, bw, bh];
    } else if (shapeTag.startsWith('<polygon')) {
      const p = nums(attr(shapeTag, 'points'));
      const xs = p.filter((_, i) => i % 2 === 0), ys = p.filter((_, i) => i % 2 === 1);
      [x, y, w, h] = [cx + Math.min(...xs), cy + Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    } else {
      const r = Math.max(0, ...[...body.matchAll(/\sr="([\d.]+)"/g)].map((m) => +m[1]));
      const ccx = cx + +(attr(shapeTag, 'cx') ?? 0), ccy = cy + +(attr(shapeTag, 'cy') ?? 0);
      [x, y, w, h] = [ccx - r, ccy - r, r * 2, r * 2];
    }
    const style = attr(shapeTag, 'style');
    const textStyle = attr(body.match(/<text[^>]*>/)?.[0] ?? '', 'style');
    return {
      id: attr(open, 'data-id'), cls, body, cx, cy, x, y, w, h,
      label: labelOf(body),
      fill: cssProp(style, 'fill'), stroke: cssProp(style, 'stroke'),
      strokeWidth: cssProp(style, 'stroke-width'), dashed: !!cssProp(style, 'stroke-dasharray'),
      fontColor: cssProp(textStyle, 'fill'),
    };
  });
}

/**
 * Subgraphs and composite states (also class namespaces and sequence boxes). A title that
 * a line crosses moves to a layer above the lines, so `crossed` tells us Pele found no
 * clear spot for it. x, y, w, h stay undefined if Pele drew no <rect>.
 */
export function readClusters(svg) {
  const moved = new Map(groups(svg, 'pele-cluster-title(?=[ "])').map(({ open, body }) => [attr(open, 'data-id'), body]));
  return groups(svg, 'pele-cluster(?=[ "])').map(({ open, body }) => {
    const id = attr(open, 'data-id');
    const rect = body.match(/<rect\b[^>]*>/)?.[0];
    const title = (moved.get(id) ?? body).match(/<text class="pele-cluster-label"[^>]*>[\s\S]*?<\/text>/)?.[0] ?? '';
    const style = attr(rect ?? '', 'style');
    const box = rect ? { x: +attr(rect, 'x'), y: +attr(rect, 'y'), w: +attr(rect, 'width'), h: +attr(rect, 'height') } : {};
    return {
      id, ...box, label: labelOf(title), crossed: moved.has(id), titleX: +(attr(title, 'x') ?? box.x + box.w / 2),
      fill: cssProp(style, 'fill'), stroke: cssProp(style, 'stroke'),
      strokeWidth: cssProp(style, 'stroke-width'), dashed: !!cssProp(style, 'stroke-dasharray'),
      fontColor: cssProp(attr(title, 'style'), 'fill'),
    };
  });
}

export function readEdges(svg, nodes, frames = []) {
  const endAt = (p) => nodeAt(p, nodes) ?? frameAt(p, frames);
  const labels = new Map(groups(svg, 'pele-edge-label(?=[ "])').map(({ open, body }) => {
    const rect = body.match(/<rect[^>]*>/)?.[0];
    const text = body.match(/<text[^>]*>/)[0];
    const c = rect
      ? [+attr(rect, 'x') + +attr(rect, 'width') / 2, +attr(rect, 'y') + +attr(rect, 'height') / 2]
      : [+attr(text, 'x'), +attr(text, 'y') - 5];
    return [attr(open, 'data-id'), { text: labelOf(body).join(' '), c }];
  }));
  return groups(svg, 'pele-edge(?=[ "])').map(({ open, body }) => {
    const paths = [...body.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
    const line = paths.find((p) => !/pele-marker/.test(p));
    const pts = polyline(attr(line, 'd'));
    // a closed marker (arrowhead, triangle, diamond) starts at its tip on the node border
    for (const m of paths.filter((p) => /pele-marker/.test(p) && /Z"/.test(p))) {
      const tip = nums(attr(m, 'd')).slice(0, 2);
      const dist = (p) => Math.hypot(p[0] - tip[0], p[1] - tip[1]);
      if (dist(pts.at(-1)) <= dist(pts[0])) pts.push(tip);
      else pts.unshift(tip);
    }
    const style = attr(open, 'style');
    const id = attr(open, 'data-id');
    return {
      id, pts,
      source: endAt(pts[0]), target: endAt(pts.at(-1)),
      label: labels.get(id), dashed: /stroke-dasharray/.test(line + (style ?? '')),
      stroke: cssProp(style, 'stroke'), strokeWidth: cssProp(style, 'stroke-width'),
    };
  });
}
