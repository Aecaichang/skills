// One standalone .html page around the themed SVGs (house website style, light theme only).
import { FONT_URL } from './skin.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `:root{color-scheme:light;--paper:#f5f8fb;--ink:#17212b;--muted:#56636f;--line:#d3dde8;--grid:#e2e9f0;--blue:#1d5fbf;--blue-s:#dde8f8}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);font-family:'Anuphan',system-ui,sans-serif;line-height:1.6;font-size:16px;background-color:var(--paper);
background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px),linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);
background-size:120px 120px,120px 120px,24px 24px,24px 24px}
.wrap{max-width:1120px;margin:0 auto;padding:32px 16px 64px}
header{display:flex;gap:18px;align-items:center;margin-bottom:28px}
.tile{width:72px;height:72px;border-radius:18px;background:var(--ink);box-shadow:6px 6px 0 var(--blue-s);display:grid;place-items:center;flex:none}
.tile svg{width:36px;height:36px;stroke:#fff;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
h1{margin:0;font-size:30px;letter-spacing:-.02em;line-height:1.2}
h2{font-size:22px;margin:36px 0 12px;letter-spacing:-.01em;display:flex;align-items:center;gap:10px}
h2 .n{background:var(--blue);color:#fff;border-radius:8px;width:32px;height:32px;display:grid;place-items:center;font-size:16px;flex:none}
.sub{color:var(--muted);margin:4px 0 0}
.fig{background:#fff;border:1.5px solid var(--ink);border-radius:12px;padding:14px;box-shadow:5px 5px 0 var(--blue-s);overflow-x:auto}
.fig svg{display:block;margin:0 auto;max-width:100%;height:auto}
.fig:focus-visible{outline:3px solid var(--blue);outline-offset:3px}
details{margin-top:12px;color:var(--muted);font-size:14.5px}
summary{cursor:pointer;font-weight:600}
summary:focus-visible{outline:3px solid var(--blue);outline-offset:3px;border-radius:4px}
pre{background:#fff;border:1.5px solid var(--ink);border-radius:12px;padding:12px 16px;overflow-x:auto;font-size:13.5px;line-height:1.5;color:var(--ink)}
.sq{width:1080px;height:1080px;margin:32px auto;padding:40px;background:#fff;border:1.5px solid var(--ink);border-radius:24px;box-shadow:8px 8px 0 var(--blue-s);overflow:hidden;display:flex;flex-direction:column;gap:20px}
.sq header{margin:0}
.sq .fig{flex:1;min-height:0;border:0;box-shadow:none;padding:0;overflow:hidden;display:flex;align-items:center;justify-content:center}
.sq .fig svg{max-width:100%;max-height:100%;width:auto;height:auto}
.sq .src{color:var(--muted);font-size:14px;margin:0}
@media(max-width:520px){h1{font-size:24px}.tile{width:56px;height:56px}}
@media print{body{background:#fff}.fig{box-shadow:none}}`;

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M6.5 10v3a2 2 0 0 0 2 2H14"/></svg>';

/**
 * pages: [{ name, heading, svg, source }] (svg made with inline: true).
 * heading: shown above each figure; the first one is also the page title.
 */
export function buildHtml(pages, { title, subtitle, square = false } = {}) {
  const many = pages.length > 1;
  const pageTitle = title ?? pages[0]?.heading ?? pages[0]?.name ?? 'แผนภาพ';
  if (square) return buildSquareHtml(pages, pageTitle, subtitle);
  const figs = pages.map((p, i) => {
    const head = many ? `<h2><span class="n">${i + 1}</span>${esc(p.heading ?? p.name)}</h2>` : '';
    const src = p.source ? `\n<details><summary>ต้นฉบับ Mermaid</summary><pre>${esc(p.source.trim())}</pre></details>` : '';
    return `${head}<div class="fig" tabindex="0">${p.svg}</div>${src}`;
  }).join('\n');
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="${FONT_URL}" rel="stylesheet">
<style>
${CSS}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="tile">${ICON}</div>
  <div>
    <h1>${esc(pageTitle)}</h1>${subtitle ? `\n    <p class="sub">${esc(subtitle)}</p>` : ''}
  </div>
</header>
${figs}
</div>
</body>
</html>
`;
}

// Every page becomes one 1080 x 1080 card: title on top, figure scaled to fit, source line at the foot.
function buildSquareHtml(pages, pageTitle, subtitle) {
  const cards = pages.map((p, i) => {
    const t = pages.length > 1 ? (p.heading ?? p.name) : pageTitle;
    return `<section class="sq">
<header>
  <div class="tile">${ICON}</div>
  <div>
    <h1>${esc(t)}</h1>${subtitle ? `\n    <p class="sub">${esc(subtitle)}</p>` : ''}
  </div>
</header>
<div class="fig">${p.svg}</div>
<p class="src">ภาพ ${i + 1} จาก ${pages.length}</p>
</section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1120">
<title>${esc(pageTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="${FONT_URL}" rel="stylesheet">
<style>
${CSS}
</style>
</head>
<body>
${cards}
</body>
</html>
`;
}
