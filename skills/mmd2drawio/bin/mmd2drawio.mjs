#!/usr/bin/env node
// mmd2drawio: Mermaid (.mmd / .mermaid / ```mermaid in .md) -> .drawio (+ PNG/SVG).
import { mkdtempSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, extname, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { convert, toMxfile, mermaidBlocks, THEMES } from '../src/convert.mjs';
import { splitEr } from '../src/er-split.mjs';
import { skinPage } from '../src/skin.mjs';
import { buildHtml } from '../src/html.mjs';
import { FONT_URL } from '../src/skin.mjs';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const HELP = `mmd2drawio — แปลง Mermaid เป็น HTML/SVG สวย ๆ (ตัวเลือกเสริม: .drawio ที่ลากแก้ได้)

ค่าเริ่มต้น: ได้ <ชื่อ>.html ไฟล์เดียวเปิดได้เลย (สไตล์การ์ดโค้งมน ฟอนต์ Anuphan ธีมสว่าง)

ใช้:  mmd2drawio <ไฟล์หรือโฟลเดอร์...> [ตัวเลือก]
      cat a.mmd | mmd2drawio - -o out/

รับ:  .mmd .mermaid  -> ไฟล์ละ 1 หน้า
      .md            -> ทุกบล็อก \`\`\`mermaid รวมเป็นไฟล์เดียว หน้าละ 1 ภาพ
      โฟลเดอร์        -> หาไฟล์ข้างบนทั้งหมดในโฟลเดอร์ย่อยด้วย

ตัวเลือก:
  -o, --out <dir>     โฟลเดอร์ผลลัพธ์ (ค่าเริ่มต้น: ข้างไฟล์ต้นฉบับ)
  -t, --theme <name>  ชุดสี: ${Object.keys(THEMES).join(' | ')} (ค่าเริ่มต้น blue, ฟอนต์ Sarabun เสมอ)
      --svg           โหมด SVG ล้วน: ได้ <ชื่อ>.svg (หลายหน้า = <ชื่อ>-1.svg ...) ไม่ทำ .html ใช้ฝังในเอกสารอื่น
      --html          ทำ .html ด้วย เมื่อใช้คู่กับ --svg (ได้ทั้งสองแบบ)
      --drawio        เขียน .drawio ด้วย (ลากแก้ใน draw.io หรือ Google Drive)
      --square        HTML เป็นการ์ดจตุรัส 1080 x 1080 หน้าละภาพ (กฎผู้ใช้ 7 พ.ย. 2569: ภาพสรุปต้องจตุรัส)
      --png           ได้ <ชื่อ>.png สไตล์เดียวกับ HTML (ใช้ Chrome headless) สำหรับแปะ Word/Excel/ชีต
      --drawio-png    PNG จาก draw.io desktop (สไตล์ draw.io เดิม ใช้ --drawio ให้เอง)
      --no-png        (คงไว้ให้สคริปต์เก่า ไม่มีผล)
      --scale <n>     ขนาด PNG (ค่าเริ่มต้น 2)
      --title [text]  ใส่หัวเรื่องเหนือภาพ (ไม่ใส่ข้อความ = ใช้ title ใน Mermaid)
      --legend        ใส่คำอธิบายสัญลักษณ์ใต้ภาพ (flowchart, state, sequence, ER)
      --split         ER ใหญ่: แยกหน้าละกลุ่มตารางที่เชื่อมกัน + หน้าตารางเดี่ยว
      --repo <dir>    ตรวจว่าไฟล์และบรรทัดใน %% src มีจริงใน repo นี้
      --strict        มี warning = ล้มเหลว และไม่เขียนทับไฟล์เดิม
  -h, --help          แสดงวิธีใช้
`;

const SOURCE_EXT = new Set(['.mmd', '.mermaid', '.md']);
const SKIP_DIRS = new Set(['node_modules', '.git']);

function parseArgs(argv) {
  const opts = { inputs: [], out: null, theme: 'blue', png: false, drawioPng: false, svg: false, html: false, drawio: false, scale: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a === '-t' || a === '--theme') opts.theme = argv[++i];
    else if (a === '--svg') opts.svg = true;
    else if (a === '--html') opts.html = true;
    else if (a === '--drawio') opts.drawio = true;
    else if (a === '--square') opts.square = true;
    else if (a === '--png') opts.png = true;
    else if (a === '--drawio-png') opts.drawioPng = opts.drawio = true;
    else if (a === '--no-png') opts.png = false;
    else if (a === '--scale') opts.scale = Number(argv[++i]);
    else if (a === '--legend') opts.legend = true;
    else if (a === '--split') opts.split = true;
    else if (a === '--repo') opts.repo = argv[++i];
    else if (a === '--strict') opts.strict = true;
    else if (a === '--title') {
      // the next word is the title text unless it is another option or a file to convert
      const next = argv[i + 1];
      opts.title = next !== undefined && !next.startsWith('-') && !existsSync(next) ? argv[++i] : true;
    }
    else if (a.startsWith('-') && a !== '-') throw new Error(`ไม่รู้จักตัวเลือก ${a} (ดู --help)`);
    else opts.inputs.push(a);
  }
  if (!opts.svg) opts.html = true; // default output is the HTML page; --svg alone means SVG only
  if (!THEMES[opts.theme]) throw new Error(`ไม่มีธีม "${opts.theme}" (มี: ${Object.keys(THEMES).join(', ')})`);
  if (!(opts.scale > 0)) throw new Error('--scale ต้องเป็นตัวเลขมากกว่า 0');
  return opts;
}

function collect(path, found = []) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path).sort()) if (!SKIP_DIRS.has(name)) collect(join(path, name), found);
  } else if (SOURCE_EXT.has(extname(path).toLowerCase())) found.push(path);
  return found;
}

/** Path relative to the current folder when the file is inside it, else absolute. */
const shortPath = (f) => (relative(process.cwd(), f).startsWith('..') ? f : relative(process.cwd(), f));

function findDrawio() {
  const candidates = ['drawio', '/Applications/draw.io.app/Contents/MacOS/draw.io', '/opt/homebrew/bin/drawio', '/usr/local/bin/drawio'];
  for (const c of candidates) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 15000 }); return c; } catch { /* try the next one */ }
  }
  return null;
}

function findChrome() {
  for (const c of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', 'google-chrome', 'chromium']) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 15000 }); return c; } catch { /* next */ }
  }
  return null;
}

/** Screenshot one inline SVG with headless Chrome so the PNG matches the HTML look. */
function svgToPng(chrome, svg, w, h, out, scale) {
  const dir = mkdtempSync(join(tmpdir(), 'mmd2drawio-png-'));
  const page = join(dir, 'p.html');
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><link href="${FONT_URL}" rel="stylesheet"><style>html,body{margin:0;background:#fff}svg{display:block}</style>${svg}`);
  try {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, `--force-device-scale-factor=${scale}`, '--virtual-time-budget=8000', `--screenshot=${out}`, `file://${page}`], { stdio: 'ignore', timeout: 60000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function exportImages(drawio, file, pageCount, opts) {
  const made = [];
  for (const fmt of ['png']) {
    for (let p = 1; p <= pageCount; p++) {
      const out = file.replace(/\.drawio$/, `${pageCount > 1 ? `-${p}` : ''}.${fmt}`);
      const args = ['-x', '-f', fmt, '-s', String(opts.scale), '-p', String(p), '-o', out, file];
      try {
        execFileSync(drawio, args, { stdio: 'ignore', timeout: 60000 });
        made.push(basename(out));
      } catch (e) {
        console.warn(`  ! export ${basename(out)} ไม่สำเร็จ (.drawio ยังใช้ได้): ${e.message.split('\n')[0]}`);
      }
    }
  }
  return made;
}

/** Convert one source (text + name) into a .drawio file; returns a report row. */
function convertOne(text, name, isMarkdown, outDir, opts) {
  const blocks = isMarkdown ? mermaidBlocks(text) : [text];
  if (!blocks.length) return null; // a .md with no mermaid blocks is not an error
  const t0 = performance.now();
  const sources = blocks.flatMap((src) => (opts.split ? splitEr(src) : [{ src }]));
  const pages = sources.map(({ src, name }, i) => {
    const r = convert(src, { theme: opts.theme, title: name && opts.title === true ? name : opts.title, legend: opts.legend, repo: opts.repo });
    return { ...r, src, name: name ?? r.title ?? (sources.length > 1 ? `${i + 1} ${r.kind}` : r.kind) };
  });
  const ms = performance.now() - t0;
  const problems = pages.flatMap((p) => p.warnings.map((w) => `${p.name}: ${w}`));
  if (opts.strict && problems.length) {
    for (const w of problems) console.error(`  ! ${w}`);
    throw new Error(`ไม่ผ่านการตรวจ ${problems.length} ข้อ ไฟล์เดิมไม่ถูกเขียนทับ`);
  }
  mkdirSync(outDir, { recursive: true });
  const made = [];
  // rename, so a crash mid-write can't leave a broken file over the last good one
  const put = (path, text) => { const tmp = `${path}.tmp`; writeFileSync(tmp, text); renameSync(tmp, path); made.push(path); };
  const th = THEMES[opts.theme];
  const many = pages.length > 1;
  if (opts.html) {
    const skinned = pages.map((p, i) => {
      const s = skinPage(p, { th, uid: `d${i + 1}`, inline: true, dropTitle: true });
      return { name: p.name, heading: typeof opts.title === 'string' && !many ? opts.title : s.title ?? p.title ?? (many ? p.name : name), svg: s.svg, source: p.src };
    });
    put(join(outDir, `${name}.html`), buildHtml(skinned, { title: typeof opts.title === 'string' ? opts.title : undefined, square: opts.square }));
  }
  if (opts.svg) {
    pages.forEach((p, i) => put(join(outDir, `${name}${many ? `-${i + 1}` : ''}.svg`), skinPage(p, { th, uid: `d${i + 1}` }).svg));
  }
  if (opts.png) {
    const chrome = findChrome();
    if (!chrome) console.warn('ไม่พบ Chrome: ไม่ได้ทำ PNG (ติดตั้ง Google Chrome หรือใช้ --drawio-png)');
    else pages.forEach((p, i) => {
      const k = skinPage(p, { th, uid: `d${i + 1}`, inline: true });
      const out = join(outDir, `${name}${many ? `-${i + 1}` : ''}.png`);
      try { svgToPng(chrome, k.svg, k.width, k.height, out, opts.scale); made.push(out); } catch (e) { console.warn(`  ! PNG ${basename(out)} ไม่สำเร็จ: ${e.message.split('\n')[0]}`); }
    });
  }
  const file = join(outDir, `${name}.drawio`);
  if (opts.drawio) put(file, toMxfile(pages));
  return { file: made[0], made, drawio: opts.drawio ? file : null, pages, ms };
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (opts.help || !opts.inputs.length) { console.log(HELP); process.exit(opts.help ? 0 : 2); }

  const jobs = [];
  for (const input of opts.inputs) {
    if (input === '-') { jobs.push({ text: readFileSync(0, 'utf8'), name: 'diagram', md: false, dir: opts.out ?? process.cwd() }); continue; }
    if (!existsSync(input)) { console.error(`ไม่พบ: ${input}`); process.exitCode = 1; continue; }
    // with -o, keep each file's sub-folder so same-named files in different folders don't clash
    const isDir = statSync(input).isDirectory();
    const prefix = isDir && opts.inputs.length > 1 ? basename(resolve(input)) : '';
    for (const f of collect(input)) {
      const dir = opts.out ? join(opts.out, prefix, isDir ? relative(input, dirname(f)) : '') : dirname(f);
      jobs.push({ text: readFileSync(f, 'utf8'), name: basename(f, extname(f)), md: extname(f).toLowerCase() === '.md', dir });
    }
  }
  if (!jobs.length) { console.error('ไม่พบไฟล์ Mermaid ที่จะแปลง'); process.exit(1); }
  // last guard: two sources would still write the same .drawio (e.g. a.mmd and a.md side by side)
  const seen = new Map();
  for (const job of jobs) {
    const key = resolve(job.dir, job.name);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) job.name = `${job.name}-${n}`;
  }

  const drawio = opts.drawioPng ? findDrawio() : null;
  if (opts.drawioPng && !drawio) console.warn('ไม่พบ draw.io desktop: ได้ .drawio แต่ไม่มี PNG (ติดตั้ง: brew install --cask drawio)');

  let failed = 0, done = 0;
  for (const job of jobs) {
    try {
      const r = convertOne(job.text, job.name, job.md, resolve(job.dir), opts);
      if (!r) continue;
      const images = drawio && r.drawio ? exportImages(drawio, r.drawio, r.pages.length, opts) : [];
      const kinds = r.pages.map((p) => `${p.kind}${p.native ? '' : ' (ภาพ)'}`).join(', ');
      const extra = [...r.made.slice(1).map((f) => basename(f)), ...images];
      console.log(`✓ ${shortPath(r.file)}  [${kinds}]  ${r.ms.toFixed(0)} ms${extra.length ? `  + ${extra.join(', ')}` : ''}`);
      for (const p of r.pages) for (const w of p.warnings) console.warn(`  ! ${p.name}: ${w}`);
      done++;
    } catch (e) {
      failed++;
      console.error(`✗ ${job.name}: ${e.message}`);
    }
  }
  console.log(`เสร็จ ${done} ไฟล์${failed ? `, ล้มเหลว ${failed}` : ''}`);
  if (failed) process.exitCode = 1;
}

main();
