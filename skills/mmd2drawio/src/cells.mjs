// Shared draw.io output: theme colors, font, rounding and the cell writer.
import { esc, project } from './svg.mjs';

// Font is always Sarabun; a theme only sets colors. blue is the default.
export const THEMES = {
  blue: { ink: '#222b47', muted: '#5b6577', link: '#4b77be', paper: '#f5f7fa', node: '#ffffff', alt: '#eef3f9', border: '#c5d3e3', accent: '#3598dc' },
  neutral: { ink: '#2d3142', muted: '#4f5d75', link: '#2e5aa8', paper: '#f5f5f5', node: '#ffffff', alt: '#ececec', border: '#bfc0c0', accent: '#eb6c36' },
};
export const FONT = 'Sarabun';
// fontSource lets draw.io on the web (and Google Drive) load Sarabun itself instead of
// falling back to another font on machines that don't have it installed
export const FONT_STYLE = `fontFamily=${FONT};fontSource=${encodeURIComponent(`https://fonts.googleapis.com/css?family=${FONT}`)};`;
export const MARGIN = 20;
/** The page as a frame: shapes and lines on it are offset by the margin. */
export const PAGE = { cell: '1', x: -MARGIN, y: -MARGIN };

export const r1 = (n) => Math.round(n * 10) / 10;
export const r4 = (n) => Math.round(n * 10000) / 10000; // pin fractions: 0.01 of a 570px lifeline is 6px
export const clamp01 = (n) => Math.min(1, Math.max(0, n));
export const at = (x) => r1(x + MARGIN);
export const html = (s) => esc(s);

export class Cells {
  constructor() { this.list = []; this.n = 0; }
  id(prefix) { return `${prefix}${this.n++}`; }
  /** `data` adds custom attributes; draw.io then wraps the cell in an <object>. */
  vertex({ id = this.id('v'), value = '', style, x, y, w, h, parent = '1', data }) {
    const geo = `<mxGeometry x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" as="geometry"/>`;
    const extra = Object.entries(data ?? {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    this.list.push(data
      ? `<object id="${id}" label="${esc(value)}"${extra}><mxCell style="${style}" vertex="1" parent="${parent}">${geo}</mxCell></object>`
      : `<mxCell id="${id}" value="${esc(value)}" style="${style}" vertex="1" parent="${parent}">${geo}</mxCell>`);
    return id;
  }
  /** pts are absolute (pre-margin) route points; source/target are cell ids or undefined. */
  edge({ value = '', style, pts, source, target, label, autoRoute = false, frame = PAGE }) {
    const id = this.id('e');
    const xy = ([x, y]) => `x="${r1(x - frame.x)}" y="${r1(y - frame.y)}"`; // stored relative to the parent
    if (autoRoute) label = null; // draw.io places the label at the middle of its own route
    const way = autoRoute ? '' : pts.slice(1, -1).map((p) => `<mxPoint ${xy(p)}/>`).join('');
    let geo = 'relative="1" as="geometry"', off = '';
    if (label) {
      const p = project(pts, label.c);
      geo = `x="${r4(p.frac * 2 - 1)}" ${geo}`;
      off = `<mxPoint x="${r1(p.off[0])}" y="${r1(p.off[1])}" as="offset"/>`;
    }
    const ends = `${source ? ` source="${source}"` : ''}${target ? ` target="${target}"` : ''}`;
    this.list.push(`<mxCell id="${id}" value="${esc(value)}" style="${style}" edge="1" parent="${frame.cell}"${ends}>` +
      `<mxGeometry ${geo}><mxPoint ${xy(pts[0])} as="sourcePoint"/>` +
      `<mxPoint ${xy(pts.at(-1))} as="targetPoint"/><Array as="points">${way}</Array>${off}</mxGeometry></mxCell>`);
    return id;
  }
  /** A text label riding on an edge, placed where Pele drew it (moves with the edge). */
  edgeText(edgeId, pts, value, c, th) {
    const p = project(pts, c);
    this.list.push(`<mxCell id="${this.id('t')}" value="${esc(value)}" style="edgeLabel;html=1;align=center;verticalAlign=middle;` +
      `${FONT_STYLE}fontSize=12;fontColor=${th.muted};labelBackgroundColor=none;" vertex="1" connectable="0" parent="${edgeId}">` +
      `<mxGeometry x="${r4(p.frac * 2 - 1)}" relative="1" as="geometry"><mxPoint x="${r1(p.off[0])}" y="${r1(p.off[1])}" as="offset"/></mxGeometry></mxCell>`);
  }
}

export const textStyle = (th, n = {}) => `html=1;whiteSpace=wrap;${FONT_STYLE}fontSize=14;fontColor=${n.fontColor ?? th.ink};`;
export const lineStyle = (th, e = {}) => `html=1;rounded=1;${FONT_STYLE}fontSize=12;fontColor=${th.muted};` +
  `labelBackgroundColor=${th.paper};strokeColor=${e.stroke ?? th.muted};` +
  (e.strokeWidth ? `strokeWidth=${parseFloat(e.strokeWidth)};` : '') + (e.dashed ? 'dashed=1;' : '');
/** Pin an edge end where Pele drew it, as a fraction of the node box. */
export const pin = (n, [x, y], k) => n ? `${k}X=${r4(clamp01((x - n.x) / n.w))};${k}Y=${r4(clamp01((y - n.y) / n.h))};${k}Perimeter=0;` : '';
export const arrow = (spec, end) => { const [shape, fill] = spec.split(';'); return `${end}Arrow=${shape};${end}${fill};${end}Size=${shape.startsWith('diamond') ? 12 : 8};`; };
