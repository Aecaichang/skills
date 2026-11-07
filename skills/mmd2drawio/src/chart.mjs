// xychart (bar and line) as native draw.io shapes: each bar is its own rectangle
// with its value on top, so people can recolor or resize bars in draw.io.
import { parse } from 'pele';
import { unesc, nums, attr, groups, polyline } from './svg.mjs';
import { FONT_STYLE, at } from './cells.mjs';

const SERIES_EXTRA = ['#7c8f6f', '#b8915a', '#9c6b50', '#6e6479'];
const CHAR_W = 8; // rough width of one character at 14px, for sizing text boxes

/** True when this chart can be drawn natively (vertical bars and/or lines). */
export function chartIsNative(src) {
  const m = parse(src);
  return m.orientation !== 'horizontal' && m.plots.length > 0 && m.plots.every((p) => p.type === 'bar' || p.type === 'line');
}

function text(cells, th, { value, x, y, w, h = 20, size = 13, color = th.muted, align = 'center', bold = false, vertical = false }) {
  cells.vertex({
    value, x: at(x), y: at(y), w, h,
    style: `text;html=1;whiteSpace=nowrap;align=${align};verticalAlign=middle;${FONT_STYLE}fontSize=${size};fontColor=${color};` +
      (bold ? 'fontStyle=1;' : '') + (vertical ? 'horizontal=0;' : ''),
  });
}

const line = (cells, pts, color, width = 1, dashed = false) =>
  cells.edge({ pts, style: `endArrow=none;html=1;strokeColor=${color};strokeWidth=${width};` + (dashed ? 'dashed=1;' : '') });

export function buildChart(svg, src, th, cells) {
  const model = parse(src);
  const series = [th.accent, th.muted, ...SERIES_EXTRA];

  // title
  const title = svg.match(/<text class="pele-title"[^>]*>([\s\S]*?)<\/text>/);
  if (title) {
    const [tx, ty] = nums(title[1].match(/x="([\d.-]+)" y="([\d.-]+)"/)?.slice(1).join(','));
    const value = unesc(title[1].replace(/<[^>]+>/g, ''));
    text(cells, th, { value, x: tx - value.length * 9, y: ty - 18, w: value.length * 18, h: 24, size: 17, color: th.ink, bold: true });
  }

  // light grid lines, then the two axis lines (ticks are left out)
  for (const seg of (svg.match(/<path class="pele-grid" d="([^"]+)"/)?.[1] ?? '').split('M').filter(Boolean)) {
    line(cells, polyline(`M${seg}`), th.alt);
  }
  const axis = svg.match(/<path class="pele-axis" d="([^"]+)"/)?.[1] ?? '';
  for (const seg of axis.split('M').filter(Boolean).slice(0, 2)) line(cells, polyline(`M${seg.replace(/[hv].*$/, '')}`), th.border);

  // bars: Pele lists them series by series, in category order
  const bars = model.plots.filter((p) => p.type === 'bar');
  const rects = [...(svg.match(/<g class="pele-series pele-bars"[\s\S]*?<\/g>/g) ?? [])].map((g) => [...g.matchAll(/<rect [^>]*>/g)].map((m) => m[0]));
  rects.forEach((list, si) => {
    const color = series[model.plots.indexOf(bars[si])] ?? series[si];
    list.forEach((r, i) => {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => +attr(r, k));
      cells.vertex({ x: at(x), y: at(y), w, h, style: `rounded=0;html=1;fillColor=${color};strokeColor=none;` });
      const value = bars[si]?.data[i]?.[1];
      if (value !== undefined) text(cells, th, { value: String(value), x: x - 10, y: y - 20, w: w + 20, color: th.ink, bold: true });
    });
  });

  // lines
  const lines = model.plots.filter((p) => p.type === 'line');
  [...svg.matchAll(/<g class="pele-series pele-line"[^>]*>\s*<path[^>]* d="([^"]+)"/g)].forEach(([, d], li) => {
    line(cells, polyline(d), series[model.plots.indexOf(lines[li])] ?? th.link, 2);
  });

  // axis labels and titles
  for (const { body } of groups(svg, 'pele-axis-labels')) {
    for (const [, x, y, anchor, t] of body.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="(\w+)">([^<]*)</g)) {
      const value = unesc(t), w = value.length * CHAR_W + 12;
      const left = anchor === 'end' ? +x - w : anchor === 'middle' ? +x - w / 2 : +x;
      text(cells, th, { value, x: left, y: +y - 15, w, align: anchor === 'end' ? 'right' : anchor === 'middle' ? 'center' : 'left' });
    }
  }
  for (const [, tx, ty, rot, t] of svg.matchAll(/<g transform="translate\(([\d.-]+),([\d.-]+)\)( rotate\(-90\))?"><text[^>]*>([^<]*)</g)) {
    const value = unesc(t), len = value.length * CHAR_W + 16;
    if (rot) text(cells, th, { value, x: +tx - 10, y: +ty - len / 2, w: 20, h: len, color: th.ink, vertical: true });
    else text(cells, th, { value, x: +tx - len / 2, y: +ty - 10, w: len, color: th.ink });
  }
}
