// Checks run before a diagram is delivered. Every issue has a stable code, the exact
// subject and one supported fix, so a failed run can be repaired without guessing.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { textWidth } from './extras.mjs';

const TOUCH = 2; // px of overlap treated as boxes merely touching
const STEP = 4; // px between the points tested along a line

const FIX = {
  'box-overlap': 'แยกเป็นภาพรวม + ภาพรายละเอียด หรือเปลี่ยนทิศ flowchart',
  'edge-through-box': 'สลับลำดับเส้นใน Mermaid หรือเปลี่ยนทิศ flowchart',
  'label-overflow': 'ย่อข้อความ หรือขึ้นบรรทัดใหม่ด้วย <br/>',
  'route-no-edge': 'แก้ %% route ให้ตามเส้นที่มีจริง ห้ามเพิ่มเส้นเพื่อให้ผ่าน',
  'src-unknown-node': 'แก้ id ใน %% src ให้ตรงกับกล่องในภาพ',
  'src-file-missing': 'เปิดไฟล์จริงใน repo แล้วแก้ path',
  'src-line-missing': 'เปิดไฟล์จริงใน repo แล้วแก้เลขบรรทัด',
  'notes-unsupported': 'ลบ %% src / %% route หรือเขียนเป็น flowchart หรือ state',
  'edge-through-title': 'ย่อชื่อกลุ่ม หรือเปลี่ยนทิศ flowchart',
  'cluster-dropped': 'เขียนเป็น flowchart + subgraph หรือลบ namespace / box ถ้าไม่ต้องการกรอบ',
};

export const issue = (code, detail) => ({ code, detail });
export const formatIssue = ({ code, detail }) => `[${code}] ${detail} → แก้: ${FIX[code]}`;

const nameOf = (n) => n.label?.join(' ') || n.id;
export const contains = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
const nested = (a, b) => contains(a, b) || contains(b, a);

function overlap(a, b) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > TOUCH &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > TOUCH;
}

/** Walk the segment in small steps: routes can run diagonally, not only along the axes. */
function segmentCrosses([x1, y1], [x2, y2], n) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / STEP) || 1;
  for (let i = 0; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps, y = y1 + ((y2 - y1) * i) / steps;
    if (x > n.x + TOUCH && x < n.x + n.w - TOUCH && y > n.y + TOUCH && y < n.y + n.h - TOUCH) return true;
  }
  return false;
}

/** Geometry problems in a flowchart or state diagram, read from Pele's layout. */
export function findLayoutIssues(nodes, edges, frames = []) {
  const out = [];
  nodes.forEach((a, i) => {
    for (const b of nodes.slice(i + 1)) {
      if (overlap(a, b) && !nested(a, b)) out.push(issue('box-overlap', `"${nameOf(a)}" ทับ "${nameOf(b)}"`));
    }
  });
  for (const e of edges) {
    const others = nodes.filter((n) => n !== e.source && n !== e.target &&
      ![e.source, e.target].some((end) => end && nested(n, end)));
    for (const n of others) {
      if (e.pts.slice(1).some((p, i) => segmentCrosses(e.pts[i], p, n))) {
        out.push(issue('edge-through-box', `เส้น "${e.source ? nameOf(e.source) : '?'}" → "${e.target ? nameOf(e.target) : '?'}" ผ่านกล่อง "${nameOf(n)}"`));
      }
    }
  }
  for (const n of nodes.filter((m) => /pele-shape-rect|pele-state\b/.test(m.cls))) {
    const wide = n.label.find((line) => textWidth(line) > n.w);
    if (wide) out.push(issue('label-overflow', `"${wide}" ยาวกว่ากล่อง`));
  }
  // Pele lifts such a title above the line; a draw.io container label can't leave its layer
  for (const f of frames.filter((c) => c.crossed)) out.push(issue('edge-through-title', `"${nameOf(f)}"`));
  return out;
}

/** Frames left out of the drawing: named, so they can't vanish without a trace. */
export const droppedFrames = (frames) => frames.map((f) => issue('cluster-dropped', `"${nameOf(f)}"`));

/** "%% src <id>: path:line [revision]" and "%% route: A -> B -> C" comments in the source. */
export function parseNotes(src) {
  const sources = [...src.matchAll(/^\s*%%\s*src\s+(\S+)\s*:\s*(.+?)\s*$/gm)].map(([, id, ref]) => {
    const [, path, line] = ref.match(/^(\S+?)(?::(\d+))?(?:-\d+)?(?:\s|$)/) ?? [];
    return { id, ref, path, line: line ? +line : undefined };
  });
  const route = src.match(/^\s*%%\s*route\s*:\s*(.+?)\s*$/m)?.[1].split(/\s*->\s*/) ?? [];
  return { sources, route };
}

/** Confirm each cited file and line really exists under the repository root. */
export function checkSources(sources, root) {
  const out = [];
  for (const { id, ref, path, line } of sources) {
    if (!path || /^https?:/.test(path)) continue;
    const file = resolve(root, path);
    if (!existsSync(file) || !statSync(file).isFile()) out.push(issue('src-file-missing', `${id}: ${ref}`));
    else if (line && line > readFileSync(file, 'utf8').split('\n').length) out.push(issue('src-line-missing', `${id}: ${ref}`));
  }
  return out;
}
