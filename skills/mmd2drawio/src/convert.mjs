// Mermaid -> draw.io. Pele parses and lays out; this file writes native draw.io cells.
// Native (editable shapes): flowchart, state, sequence, er, class, xychart (bars/lines).
// Everything else Pele can draw is embedded as one themed SVG image with the source kept.
import { render, parse } from 'pele';
import { esc, unesc, nums, attr, groups, labelOf, polyline, project, readNodes, readEdges, readClusters } from './svg.mjs';

import { buildChart, chartIsNative } from './chart.mjs';
import { addTitle, addLegend, addSources } from './extras.mjs';
import { issue, formatIssue, findLayoutIssues, droppedFrames, contains, parseNotes, checkSources } from './check.mjs';
import { THEMES, FONT, FONT_STYLE, MARGIN, PAGE, r1, r4, clamp01, at, html, Cells, textStyle, lineStyle, pin, arrow } from './cells.mjs';

export { THEMES };
export const NATIVE = ['flowchart', 'state', 'sequence', 'er', 'class'];
const BADGE_W = 26, BADGE_H = 18; // the S1 source tag on a box's corner
const FRAME_ARC = 8, FRAME_TITLE_TOP = 4; // px: corner radius, gap above a frame's title
const SELF_LOOP = 36; // how far a self-reference loop sticks out of its table
const AUTO_ROUTE_MAX = 8; // ER entity count up to which draw.io routes the lines itself
const LANDSCAPE = 1.6; // preferred width/height when choosing an ER layout
const ROUTE_NODE_WIDTH = '2', ROUTE_EDGE_WIDTH = '2.5'; // %% route marks its path in the accent color
const ER_ARROW = { ONLY_ONE: 'ERmandOne', ZERO_OR_ONE: 'ERzeroToOne', ONE_OR_MORE: 'ERoneToMany', ZERO_OR_MORE: 'ERzeroToMany' };
// Mermaid class relation codes: 0 aggregation, 1 extension, 2 composition, 3 arrow, 4 lollipop
const CLASS_ARROW = { 0: 'diamondThin;Fill=0', 1: 'block;Fill=0', 2: 'diamondThin;Fill=1', 3: 'block;Fill=1', 4: 'oval;Fill=0', none: 'none;Fill=0' };

function flowNodeStyle(n, th) {
  const base = textStyle(th, n) + `fillColor=${n.fill ?? th.node};strokeColor=${n.stroke ?? th.border};` +
    (n.strokeWidth ? `strokeWidth=${parseFloat(n.strokeWidth)};` : '') + (n.dashed ? 'dashed=1;' : '');
  const c = n.cls;
  if (/pele-state-start/.test(c)) return `ellipse;html=1;fillColor=${th.ink};strokeColor=none;`;
  if (/pele-state-end/.test(c)) return `ellipse;shape=endState;html=1;fillColor=${th.ink};strokeColor=${th.ink};`;
  if (/pele-state-(fork|join)/.test(c)) return `html=1;fillColor=${th.ink};strokeColor=none;`;
  if (/pele-state-choice|pele-shape-diam/.test(c)) return `rhombus;${base}`;
  if (/pele-shape-stadium/.test(c)) return `rounded=1;arcSize=50;${base}`;
  if (/pele-shape-(circle|doublecircle)/.test(c)) return `ellipse;${base}`;
  if (/pele-shape-(cyl|cylinder)/.test(c)) return `shape=cylinder3;boundedLbl=1;size=8;${base}`;
  if (/pele-shape-(hex|hexagon)/.test(c)) return `shape=hexagon;perimeter=hexagonPerimeter2;size=0.15;${base}`;
  if (/pele-shape-(lean-r|lean-l|trap)/.test(c)) return `shape=parallelogram;perimeter=parallelogramPerimeter;size=0.15;${base}`;
  if (/pele-shape-subroutine/.test(c)) return `shape=process;size=0.08;${base}`;
  if (/pele-state\b/.test(c)) return `rounded=1;arcSize=24;${base}`;
  return `rounded=1;arcSize=8;${base}`;
}

/** A subgraph or composite state: a draw.io container, so what is inside moves with it. */
function frameStyle(f, th) {
  // the title stays centered on the x Pele chose to clear the lines, whatever the font measures
  const shift = r1(2 * (f.titleX - (f.x + f.w / 2)));
  return `rounded=1;absoluteArcSize=1;arcSize=${FRAME_ARC};container=1;collapsible=0;recursiveResize=0;html=1;whiteSpace=nowrap;` +
    `align=center;verticalAlign=top;spacingTop=${FRAME_TITLE_TOP};spacingLeft=${shift};${FONT_STYLE}fontSize=14;fontStyle=1;fontColor=${f.fontColor ?? th.muted};` +
    `fillColor=${f.fill ?? th.alt};fillOpacity=50;strokeColor=${f.stroke ?? th.border};` +
    (f.strokeWidth ? `strokeWidth=${parseFloat(f.strokeWidth)};` : '') + (f.dashed ? 'dashed=1;' : '');
}

function buildFlow(svg, th, cells, warnings, notes, clusters) {
  const nodes = readNodes(svg);
  // outermost first: a parent has to be written before its children, and the
  // last frame around a box in this order is the innermost one
  const frames = [...clusters].sort((a, b) => b.w * b.h - a.w * a.h);
  const frameOf = (...boxes) => frames.findLast((f) => boxes.every((b) => b && b !== f && contains(f, b))) ?? PAGE;
  for (const f of frames) {
    const up = frameOf(f);
    f.cell = cells.vertex({ value: f.label.map(html).join('<br>'), style: frameStyle(f, th), x: f.x - up.x, y: f.y - up.y, w: f.w, h: f.h, parent: up.cell });
  }
  const edges = readEdges(svg, nodes, frames);
  const hop = (a, b) => `${a}\n${b}`;
  const hops = notes.route.slice(1).map((to, i) => hop(notes.route[i], to));
  const routed = new Set(edges.filter((e) => hops.includes(hop(e.source?.id, e.target?.id))).map((e) => hop(e.source.id, e.target.id)));
  const issues = findLayoutIssues(nodes, edges, frames);
  for (const h of hops) if (!routed.has(h)) issues.push(issue('route-no-edge', h.replace('\n', ' -> ')));

  const sourced = [];
  const ids = new Map(nodes.map((n) => {
    const onRoute = notes.route.includes(n.id) ? { stroke: th.accent, strokeWidth: ROUTE_NODE_WIDTH } : {};
    const ref = notes.sources.find((s) => s.id === n.id);
    const data = ref && { tooltip: ref.ref, ...(/^https?:/.test(ref.ref) ? { link: ref.ref.split(/\s/)[0] } : {}) };
    const up = frameOf(n);
    const x = n.x - up.x, y = n.y - up.y;
    const id = cells.vertex({
      value: n.label.map(html).join('<br>'), style: flowNodeStyle({ ...n, ...onRoute }, th),
      x, y, w: n.w, h: n.h, parent: up.cell, data,
    });
    if (ref) {
      const tag = `S${sourced.length + 1}`;
      sourced.push({ ...ref, tag });
      cells.vertex({
        // a diamond or circle has no top-right corner, so its tag sits on the top point
        value: tag, x: x + (/pele-shape-(diam|circle|doublecircle)|pele-state-choice/.test(n.cls) ? n.w / 2 : n.w) - BADGE_W / 2, y: y - BADGE_H / 2, w: BADGE_W, h: BADGE_H, parent: up.cell,
        style: `rounded=1;arcSize=30;html=1;${FONT_STYLE}fontSize=11;fontColor=#ffffff;fillColor=${th.accent};strokeColor=none;`,
      });
    }
    return [n, id];
  }));
  for (const s of notes.sources) if (!nodes.some((n) => n.id === s.id)) issues.push(issue('src-unknown-node', s.id));
  for (const e of edges) {
    if (!e.source || !e.target) warnings.push(`edge ${e.id}: no ${!e.source ? 'source' : 'target'} node found`);
    const onRoute = e.source && e.target && hops.includes(hop(e.source.id, e.target.id));
    cells.edge({
      value: html(e.label?.text ?? ''), pts: e.pts, label: e.label,
      source: ids.get(e.source) ?? e.source?.cell, target: ids.get(e.target) ?? e.target?.cell, frame: frameOf(e.source, e.target),
      style: 'endArrow=block;endFill=1;endSize=6;' + lineStyle(th, onRoute ? { ...e, stroke: th.accent, strokeWidth: ROUTE_EDGE_WIDTH } : e) + pin(e.source, e.pts[0], 'exit') + pin(e.target, e.pts.at(-1), 'entry'),
    });
  }
  warnings.push(...issues.map(formatIssue));
  return sourced;
}

function buildSequence(svg, th, cells) {
  const [tx, ty] = nums(svg.match(/<svg[^>]*>\s*<g transform="translate\(([^)]*)\)"/)?.[1] ?? '0,0');
  const move = ([x, y]) => [x + tx, y + ty];
  const life = new Map([...svg.matchAll(/<path class="pele-lifeline" data-id="([^"]+)" d="([^"]+)"/g)]
    .map(([, id, d]) => { const [x, y1, y2] = nums(d); return [id, { x: x + tx, y1: y1 + ty, y2: y2 + ty }]; }));

  // header boxes only; draw.io's lifeline shape draws the dashed line. Stick-figure
  // actors become boxes too, because draw.io's actor glyph collides with the name.
  const heads = readNodes(svg).filter((n) => /pele-actor/.test(n.cls) && !/pele-actor-footer/.test(n.cls));
  const box = heads.find((n) => /pele-actor-participant/.test(n.cls)) ?? { y: 0, h: 44 };
  const lifelines = [];
  for (const n of heads) {
    const l = life.get(n.id);
    if (!l) continue;
    const isFigure = /pele-actor-actor/.test(n.cls);
    const ref = isFigure ? box : n;
    const w = isFigure ? n.label.join(' ').length * 9 + 40 : n.w;
    const x = l.x - w / 2, y = ref.y + ty, h = l.y2 - y;
    const style = `shape=umlLifeline;perimeter=lifelinePerimeter;container=0;collapsible=0;recursiveResize=0;size=${r1(ref.h)};` +
      textStyle(th) + `fillColor=${th.node};strokeColor=${th.border};rounded=1;arcSize=10;`;
    lifelines.push({ x, y, w, h, id: cells.vertex({ value: html(n.label.join(' ')), style, x: at(x), y: at(y), w, h }) });
  }

  // combined fragments (alt/opt/loop/par…): frame, guard labels, dashed dividers
  for (const { body } of groups(svg, 'pele-frame(?=[ "])')) {
    const frame = body.match(/<rect[^>]*fill="none"[^>]*>/)?.[0];
    if (!frame) continue;
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => +attr(frame, k));
    const kind = unesc(body.match(/<text class="pele-frame-kind"[^>]*>([^<]*)</)?.[1] ?? '');
    cells.vertex({
      value: kind, x: at(x + tx), y: at(y + ty), w, h,
      style: `shape=umlFrame;whiteSpace=wrap;html=1;width=40;height=22;fillColor=none;swimlaneFillColor=none;strokeColor=${th.border};${FONT_STYLE}fontSize=12;fontStyle=1;fontColor=${th.muted};`,
    });
    for (const [, lx, ly, text] of body.matchAll(/<text class="pele-frame-label"[^>]*x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]*)</g)) {
      const tw = unesc(text).length * 8 + 12;
      cells.vertex({
        value: html(unesc(text)), x: at(+lx + tx - tw / 2), y: at(+ly + ty - 15), w: tw, h: 20,
        style: `text;html=1;align=center;verticalAlign=middle;${FONT_STYLE}fontSize=13;fontColor=${th.muted};`,
      });
    }
    for (const [, d] of body.matchAll(/<path d="([^"]+)" stroke-dasharray/g)) {
      cells.edge({ pts: polyline(d).map(move), style: `endArrow=none;dashed=1;html=1;strokeColor=${th.border};` });
    }
  }

  // notes
  for (const { body } of groups(svg, 'pele-note(?=[ "])')) {
    const rect = body.match(/<rect[^>]*>/)?.[0];
    if (!rect) continue;
    cells.vertex({
      value: labelOf(body).map(html).join('<br>'), x: at(+attr(rect, 'x') + tx), y: at(+attr(rect, 'y') + ty),
      w: +attr(rect, 'width'), h: +attr(rect, 'height'),
      style: `shape=note;size=10;${textStyle(th)}fontSize=13;fillColor=${th.alt};strokeColor=${th.border};`,
    });
  }

  // messages: pin both ends on the lifelines at the message's height
  const lineOf = ([x]) => lifelines.reduce((a, b) => (Math.abs(b.x + b.w / 2 - x) < Math.abs(a.x + a.w / 2 - x) ? b : a));
  const end = (l, [, y], k) => `${k}X=0.5;${k}Y=${r4(clamp01((y - l.y) / l.h))};${k}Perimeter=0;`;
  for (const e of readEdges(svg, [])) {
    const pts = e.pts.map(move);
    const from = lineOf(pts[0]), to = lineOf(pts.at(-1));
    cells.edge({
      value: html(e.label?.text ?? ''), pts, source: from.id, target: to.id,
      label: e.label && { c: move(e.label.c) },
      style: 'endArrow=block;endFill=1;endSize=6;' + lineStyle(th, e) + end(from, pts[0], 'exit') + end(to, pts.at(-1), 'entry'),
    });
  }
}

/** A box with a bold header and stacked text rows (ER entity, UML class). */
function tableBox(cells, th, n, head, rows) {
  const id = cells.vertex({
    value: n.raw ? n.label.join('<br>') : html(n.label.join(' ') || n.id), x: at(n.x), y: at(n.y), w: n.w, h: n.h,
    style: `swimlane;childLayout=stackLayout;horizontal=1;startSize=${r1(head)};horizontalStack=0;resizeParent=1;resizeParentMax=0;` +
      `collapsible=0;marginBottom=0;rounded=1;arcSize=4;html=1;fontStyle=1;${FONT_STYLE}fontSize=14;fontColor=${th.ink};` +
      `fillColor=${th.alt};swimlaneFillColor=${th.node};strokeColor=${th.border};`,
  });
  let y = head;
  rows.forEach((r, i) => {
    const style = r.divider
      ? `line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=3;rotatable=0;labelPosition=right;points=[];portConstraint=eastwest;strokeColor=${th.border};`
      : `text;html=1;align=left;verticalAlign=middle;spacingLeft=10;${FONT_STYLE}fontSize=13;fontColor=${th.ink};` +
        `fillColor=${r.stripe && i % 2 ? th.paper : 'none'};strokeColor=none;`;
    cells.list.push(`<mxCell id="${cells.id('r')}" value="${esc(r.html ?? '')}" style="${style}" vertex="1" parent="${id}">` +
      `<mxGeometry y="${r1(y)}" width="${r1(n.w)}" height="${r1(r.h)}" as="geometry"/></mxCell>`);
    y += r.h;
  });
  return id;
}

/** ER entity as a draw.io table: dark header, then key | name | type columns. */
function erTable(cells, th, n, attrs, head, ROW, isFocal) {
  const KEY_W = 36;
  // wide enough for the longest type (e.g. timestamptz) but never more than ~40% of the table
  const typeW = Math.min(n.w * 0.42, Math.max(44, ...attrs.map((a) => a.type.length * 7.5 + 18)));
  const nameW = n.w - KEY_W - typeW;
  const id = cells.id('t');
  const headFill = isFocal ? th.accent : th.ink;
  cells.list.push(`<mxCell id="${id}" value="${esc(n.label.join(' ') || n.id)}" style="shape=table;startSize=${r1(head)};container=1;collapsible=0;` +
    `childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=1;align=center;resizeLast=1;html=1;${FONT_STYLE}fontSize=14;` +
    `fontColor=#ffffff;fillColor=${headFill};swimlaneFillColor=${th.node};strokeColor=${isFocal ? th.accent : th.border};" vertex="1" parent="1">` +
    `<mxGeometry x="${at(n.x)}" y="${at(n.y)}" width="${r1(n.w)}" height="${r1(n.h)}" as="geometry"/></mxCell>`);
  attrs.forEach((a, i) => {
    const row = cells.id('row');
    cells.list.push(`<mxCell id="${row}" value="" style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=none;` +
      `collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;top=0;left=0;right=0;bottom=0;html=1;" vertex="1" parent="${id}">` +
      `<mxGeometry y="${r1(head + i * ROW)}" width="${r1(n.w)}" height="${ROW}" as="geometry"/></mxCell>`);
    const key = a.keys.join(',');
    const keyColor = a.keys.includes('PK') ? th.accent : th.link;
    const cols = [
      [key, KEY_W, `fontStyle=1;fontColor=${keyColor};align=center;`],
      [a.name, nameW, `fontColor=${th.ink};align=left;spacingLeft=8;`],
      [a.type, typeW, `fontColor=${th.muted};align=left;spacingLeft=8;`],
    ];
    let x = 0;
    cols.forEach(([value, w, look], c) => {
      cells.list.push(`<mxCell id="${cells.id('c')}" value="${esc(value)}" style="shape=partialRectangle;html=1;whiteSpace=wrap;connectable=0;fillColor=none;` +
        `top=0;left=0;bottom=0;right=${c < 2 ? 1 : 0};strokeColor=${th.border};overflow=hidden;${FONT_STYLE}fontSize=13;${look}" vertex="1" parent="${row}">` +
        `<mxGeometry x="${r1(x)}" width="${r1(w)}" height="${ROW}" as="geometry"><mxRectangle width="${r1(w)}" height="${ROW}" as="alternateBounds"/></mxGeometry></mxCell>`);
      x += w;
    });
  });
  return id;
}

/**
 * Small ER laid out like a hand-drawn model: the hub table in the middle, its two most
 * connected neighbours left and right on the same row, every other table on a row below
 * under the table it links to. Returns new {x, y} per node, or an empty map (keep Pele's
 * layout) when there is no single hub.
 */
/** Exit/entry sides for a line between two boxes so it leaves and arrives facing each other. */
function facingSides(a, b) {
  const side = (k, x, y) => `${k}X=${x};${k}Y=${y};`;
  const sameRow = a.y < b.y + b.h && b.y < a.y + a.h;
  const sameColumn = a.x < b.x + b.w && b.x < a.x + a.w;
  if (sameRow) return a.x < b.x ? side('exit', 1, 0.5) + side('entry', 0, 0.5) : side('exit', 0, 0.5) + side('entry', 1, 0.5);
  if (sameColumn) return a.y < b.y ? side('exit', 0.5, 1) + side('entry', 0.5, 0) : side('exit', 0.5, 0) + side('entry', 0.5, 1);
  // diagonal: leave the upper box from its bottom, enter the lower box from the side facing it
  const [up, down, upKey, downKey] = a.y < b.y ? [a, b, 'exit', 'entry'] : [b, a, 'entry', 'exit'];
  return side(upKey, 0.5, 1) + side(downKey, up.x < down.x ? 0 : 1, 0.5);
}

function starLayout(nodes, entities, rels) {
  const H_GAP = 120, V_GAP = 110; // room for relationship labels and self-reference loops
  const idOf = (n) => entities.find((e) => e.label === n.id || e.id === n.id)?.id;
  const links = rels.filter((r) => r.entityA !== r.entityB);
  const neighbours = (n) => nodes.filter((m) => m !== n && links.some((r) =>
    (r.entityA === idOf(n) && r.entityB === idOf(m)) || (r.entityB === idOf(n) && r.entityA === idOf(m))));
  const ranked = [...nodes].sort((a, b) => neighbours(b).length - neighbours(a).length);
  const hub = ranked[0];
  if (!hub || nodes.length < 3 || neighbours(hub).length === neighbours(ranked[1]).length) return new Map();

  // left: the hub's most connected neighbour; right: a neighbour with no link to it, so no
  // line has to cross the hub; anything linked to both sides goes to the row below
  const near = neighbours(hub).sort((a, b) => neighbours(b).length - neighbours(a).length);
  const left = near[0];
  const right = near.slice(1).find((n) => !neighbours(n).includes(left));
  const top = [left, hub, right].filter(Boolean);
  const out = new Map();
  let x = 0;
  for (const n of top) { out.set(n, { x, y: 0 }); x += n.w + H_GAP; }

  const rowY = Math.max(...top.map((n) => n.h)) + V_GAP;
  const centre = (n) => out.get(n).x + n.w / 2;
  const below = nodes.filter((n) => !out.has(n)).map((n) => {
    // sit under the hub when linked to it, else under the top table it links to
    const anchor = neighbours(n).includes(hub) ? hub : top.find((t) => neighbours(n).includes(t)) ?? hub;
    return { n, want: centre(anchor) - n.w / 2 };
  }).sort((a, b) => a.want - b.want);
  let minX = -Infinity;
  for (const { n, want } of below) {
    const bx = Math.max(want, minX);
    out.set(n, { x: bx, y: rowY });
    minX = bx + n.w + H_GAP;
  }
  // keep the original top-left corner so the page origin doesn't jump
  const ox = Math.min(...nodes.map((n) => n.x)), oy = Math.min(...nodes.map((n) => n.y));
  const shiftX = ox - Math.min(...[...out.values()].map((p) => p.x));
  for (const p of out.values()) { p.x += shiftX; p.y += oy; }
  return out;
}

function buildEr(svg, src, th, cells, warnings) {
  const model = parse(src);
  const entities = [...(model.entities instanceof Map ? model.entities.values() : Object.values(model.entities))];
  const nodes = readNodes(svg);
  const ROW = 30;
  const degree = new Map();
  // self-references don't make an entity central, so they don't count
  for (const r of model.relationships.filter((r) => r.entityA !== r.entityB)) {
    for (const id of [r.entityA, r.entityB]) degree.set(id, (degree.get(id) ?? 0) + 1);
  }
  const top = Math.max(0, ...degree.values());
  const focal = [...degree].filter(([, d]) => d === top);
  // "%% focal: NAME" in the source picks the accent table by hand (--split writes it too)
  const chosen = src.match(/^\s*%%\s*focal:\s*(\S+)/m)?.[1];
  const small = nodes.length <= AUTO_ROUTE_MAX;
  const moved = small ? starLayout(nodes, entities, model.relationships) : new Map();
  const ids = new Map();
  for (const n of nodes) {
    const ent = entities.find((e) => e.label === n.id || e.id === n.id) ?? { attributes: [] };
    // otherwise the one entity with the most relationships gets the accent header (only when it is a clear winner)
    const isFocal = chosen ? chosen === n.id || chosen === ent.label : focal.length === 1 && focal[0][0] === ent.id && top > 1;
    ids.set(n, erTable(cells, th, { ...n, ...moved.get(n) }, ent.attributes, n.h - ent.attributes.length * ROW, ROW, isFocal));
  }
  // Mermaid "A ||--o{ B": cardB is drawn at A's end and cardA at B's end
  const used = new Set();
  for (const e of readEdges(svg, nodes)) {
    // small models: draw.io's straight right-angle routing reads best; big models: keep
    // Pele's routes, which go around tables. Self-references always keep Pele's loop.
    const autoRoute = small && e.source !== e.target;
    // tidied layout: draw a self-reference as a small loop on the table's outer side,
    // away from the lines that join it to its neighbours
    const shift = moved.get(e.source);
    if (shift && e.source === e.target) {
      const box = { ...e.source, ...shift };
      const outer = box.x <= Math.min(...[...moved.values()].map((p) => p.x)) ? -1 : 1; // left edge of the page: loop on the left
      const sx = outer < 0 ? box.x : box.x + box.w, out = sx + outer * SELF_LOOP;
      const y1 = box.y + box.h * 0.35, y2 = box.y + box.h * 0.65;
      e.pts = [[sx, y1], [out, y1], [out, y2], [sx, y2]]; // same pre-margin space as Pele's points
      if (e.label) e.label.c = [out + outer * (e.label.text.length * 4 + 14), (y1 + y2) / 2];
      e.loopBox = box;
    }
    const entOf = (n) => entities.find((x) => x.label === n?.id);
    const a = entOf(e.source), b = entOf(e.target);
    const ri = model.relationships.findIndex((r, i) => !used.has(i) &&
      ((r.entityA === a?.id && r.entityB === b?.id) || (r.entityA === b?.id && r.entityB === a?.id)));
    if (ri < 0) { warnings.push(`edge ${e.id}: relationship not matched`); continue; }
    used.add(ri);
    const rel = model.relationships[ri];
    const startsAtA = a.id === rel.entityA;
    const startCard = startsAtA ? rel.relSpec.cardB : rel.relSpec.cardA;
    const endCard = startsAtA ? rel.relSpec.cardA : rel.relSpec.cardB;
    cells.edge({
      value: html(e.label?.text ?? ''), pts: e.pts, label: e.label,
      source: ids.get(e.source), target: ids.get(e.target),
      style: `startArrow=${ER_ARROW[startCard]};endArrow=${ER_ARROW[endCard]};startFill=0;endFill=0;startSize=10;endSize=10;` +
        lineStyle(th, { ...e, stroke: e.stroke ?? th.link, dashed: rel.relSpec.relType !== 'IDENTIFYING' }) +
        (autoRoute ? 'edgeStyle=orthogonalEdgeStyle;' : '') +
        // once tables are rearranged, Pele's attach points may face the wrong way: use facing sides
        (moved.size && autoRoute
          ? facingSides({ ...e.source, ...moved.get(e.source) }, { ...e.target, ...moved.get(e.target) })
          : pin(e.loopBox ?? e.source, e.pts[0], 'exit') + pin(e.loopBox ?? e.target, e.pts.at(-1), 'entry')),
      autoRoute,
    });
  }
}

function buildClass(svg, src, th, cells, warnings) {
  const model = parse(src);
  const nodes = readNodes(svg).filter((n) => /pele-class\b/.test(n.cls));
  const ids = new Map();
  for (const n of nodes) {
    // dividers split the box into header / attributes / methods
    const div = nums(n.body.match(/<path class="pele-divider" d="([^"]+)"/)?.[1]).filter((_, i) => i % 3 === 1).map((y) => n.cy + y);
    const [d1 = n.y + n.h, d2 = n.y + n.h] = div;
    const members = [...n.body.matchAll(/<text class="pele-member (pele-attribute|pele-method)"[^>]*>([^<]*)</g)];
    const attrs = members.filter((m) => m[1] === 'pele-attribute').map((m) => unesc(m[2]));
    const methods = members.filter((m) => m[1] === 'pele-method').map((m) => unesc(m[2]));
    const section = (list, h) => (list.length ? list.map((t) => ({ h: h / list.length, html: esc(t) })) : [{ h, html: '' }]);
    const rows = [...section(attrs, Math.max(d2 - d1 - 1, 8)), { divider: true, h: 1 }, ...section(methods, Math.max(n.y + n.h - d2, 8))];
    const note = n.body.match(/<text class="pele-annotation"[^>]*>([^<]*)</)?.[1];
    const header = note ? { label: [`<span style="font-weight:normal;font-size:12px;color:${th.muted}">${esc(unesc(note))}</span>`, esc(n.label.join(' '))], raw: true } : {};
    ids.set(n, tableBox(cells, th, { ...n, ...header }, d1 - n.y, rows));
  }
  const cards = [...svg.matchAll(/<text class="pele-cardinality" x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]*)</g)]
    .map(([, x, y, t]) => ({ c: [+x, +y - 4], text: unesc(t) }));
  const used = new Set();
  for (const e of readEdges(svg, nodes)) {
    const a = e.source?.id, b = e.target?.id;
    const ri = model.relations.findIndex((r, i) => !used.has(i) && ((r.id1 === a && r.id2 === b) || (r.id1 === b && r.id2 === a)));
    if (ri < 0) { warnings.push(`edge ${e.id}: relation not matched`); continue; }
    used.add(ri);
    const rel = model.relations[ri];
    const startsAt1 = rel.id1 === a;
    const startType = startsAt1 ? rel.relation.type1 : rel.relation.type2;
    const endType = startsAt1 ? rel.relation.type2 : rel.relation.type1;
    const id = cells.edge({
      value: html(e.label?.text ?? ''), pts: e.pts, label: e.label,
      source: ids.get(e.source), target: ids.get(e.target),
      style: arrow(CLASS_ARROW[startType] ?? CLASS_ARROW.none, 'start') + arrow(CLASS_ARROW[endType] ?? CLASS_ARROW.none, 'end') +
        lineStyle(th, { ...e, dashed: rel.relation.lineType === 1 }) + pin(e.source, e.pts[0], 'exit') + pin(e.target, e.pts.at(-1), 'entry'),
    });
    // cardinalities: the ones closest to this edge's two ends
    for (const p of [e.pts[0], e.pts.at(-1)]) {
      const near = cards.filter((k) => !k.used && Math.hypot(k.c[0] - p[0], k.c[1] - p[1]) < 40)
        .sort((k1, k2) => Math.hypot(k1.c[0] - p[0], k1.c[1] - p[1]) - Math.hypot(k2.c[0] - p[0], k2.c[1] - p[1]))[0];
      if (near) { near.used = true; cells.edgeText(id, e.pts, near.text, near.c, th); }
    }
  }
}

/** Any other diagram type: one image cell holding Pele's SVG with theme colors baked in. */
function buildImage(svg, src, th, cells) {
  const vars = `--pele-bg:${th.paper};--pele-fg:${th.ink};--pele-muted:${th.muted};--pele-line:${th.muted};--pele-surface:${th.node};` +
    `--pele-surface-alt:${th.alt};--pele-border:${th.border};--pele-accent:${th.accent};--pele-font:${FONT},sans-serif;` +
    `--pele-series-1:${th.accent};--pele-series-2:${th.muted};--pele-series-3:#7c8f6f;--pele-series-4:#b8915a;`;
  const themed = svg.replace(/style="max-width:100%;height:auto;/, `style="${vars}`);
  const [, , w, h] = nums(attr(svg.match(/<svg[^>]*>/)[0], 'viewBox'));
  cells.vertex({
    x: MARGIN, y: MARGIN, w, h, data: { mermaid: src },
    style: `shape=image;html=1;imageAspect=1;aspect=fixed;editableCssRules=.*;image=data:image/svg+xml,${Buffer.from(themed).toString('base64')};`,
  });
}

/**
 * Mermaid source -> one draw.io page model.
 * title: text to put above the diagram, or true to use the Mermaid title. legend: add a key below.
 * repo: folder that %% src paths are checked against.
 */
export function convert(src, { theme = 'blue', title, legend = false, repo } = {}) {
  const th = THEMES[theme];
  if (!th) throw new Error(`unknown theme "${theme}" (use: ${Object.keys(THEMES).join(', ')})`);
  // ER with no direction: lay out both ways (each takes milliseconds) and keep the
  // one closest to a landscape page, so small models sit side by side and big ones don't get tall
  if (/^\s*erDiagram\b/m.test(src) && !/^\s*direction\s/m.test(src)) {
    const lr = src.replace(/^(\s*erDiagram\b.*)$/m, '$1\n  direction LR');
    const misfit = (s) => { const [, , w, h] = nums(attr(render(s).svg.match(/<svg[^>]*>/)[0], 'viewBox')); return Math.abs(Math.log(w / h / LANDSCAPE)); };
    if (misfit(lr) < misfit(src)) src = lr;
  }
  const { svg } = render(src);
  const kind = attr(svg.match(/<svg[^>]*>/)[0], 'class').match(/pele-([\w-]+)/)?.[1] ?? 'unknown';
  const cells = new Cells();
  const warnings = [];
  const notes = parseNotes(src);
  const isFlow = kind === 'flowchart' || kind === 'state';
  const clusters = readClusters(svg);
  const drawn = isFlow ? clusters.filter((c) => c.w) : []; // only flow writers know how to draw a frame
  let sourced = [];
  if (!isFlow && (notes.sources.length || notes.route.length)) warnings.push(formatIssue(issue('notes-unsupported', kind)));
  if (repo) warnings.push(...checkSources(notes.sources, repo).map(formatIssue));
  if (isFlow) sourced = buildFlow(svg, th, cells, warnings, notes, drawn);
  else if (kind === 'sequence') buildSequence(svg, th, cells);
  else if (kind === 'er') buildEr(svg, src, th, cells, warnings);
  else if (kind === 'class') buildClass(svg, src, th, cells, warnings);
  else if (kind === 'xychart' && chartIsNative(src)) buildChart(svg, src, th, cells);
  else buildImage(svg, src, th, cells);
  const native = NATIVE.includes(kind) || (kind === 'xychart' && chartIsNative(src));
  if (native) warnings.push(...droppedFrames(clusters.filter((c) => !drawn.includes(c))).map(formatIssue)); // an image keeps Pele's frames
  const heading = title === true ? titleOf(src) : title;
  if (heading && native) addTitle(cells, th, heading);
  if (legend && !(native && addLegend(cells, th, kind, svg, kind === 'er' ? parse(src) : null, legendLabels(src)))) {
    warnings.push(`no legend for ${kind}${native ? '' : ' (drawn as an image)'}`);
  }
  if (sourced.length) addSources(cells, th, sourced);
  const model = `<mxGraphModel grid="1" gridSize="10" page="0" background="${th.paper}"><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
    cells.list.join('') + '</root></mxGraphModel>';
  return { model, kind, native, warnings, title: titleOf(src) };
}

/** "%% legend <class>: <label>" lines name custom colors in Thai (Mermaid class names can't be Thai). */
function legendLabels(src) {
  return new Map([...src.matchAll(/^\s*%%\s*legend\s+([\w-]+)\s*:\s*(.+?)\s*$/gm)].map((m) => [m[1], m[2]]));
}

function titleOf(src) {
  return src.match(/^---[\s\S]*?\ntitle:\s*(.+)\n[\s\S]*?---/)?.[1]?.trim()
    ?? src.match(/^\s*title\s+["']?([^"'\n]+)/m)?.[1]?.trim();
}

/** Wrap one or more page models in an .drawio file. */
export function toMxfile(pages) {
  return '<mxfile host="mmd2drawio">' +
    pages.map((p, i) => `<diagram name="${esc(p.name ?? `Page-${i + 1}`)}" id="p${i + 1}">${p.model}</diagram>`).join('') +
    '</mxfile>';
}

/** Pull ```mermaid blocks out of a Markdown document. */
export function mermaidBlocks(markdown) {
  return [...markdown.matchAll(/^(```|~~~)\s*mermaid[^\n]*\n([\s\S]*?)^\1\s*$/gm)].map((m) => m[2]);
}
