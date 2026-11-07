// --split: break a big ER diagram into one page per group of connected tables,
// plus one page for tables with no relationships, so each page stays readable.
import { parse } from 'pele';

// Mermaid writes A's cardinality marker on the left of "--" and B's on the right;
// pele stores the marker next to A as cardB and the one next to B as cardA.
const LEFT = { ONLY_ONE: '||', ZERO_OR_ONE: '|o', ONE_OR_MORE: '}|', ZERO_OR_MORE: '}o' };
const RIGHT = { ONLY_ONE: '||', ZERO_OR_ONE: 'o|', ONE_OR_MORE: '|{', ZERO_OR_MORE: 'o{' };
const quote = (s) => `"${String(s).replace(/"/g, "'")}"`;

const MAX_GROUP = 15; // tables per page before a shared "hub" table gets cut out

/**
 * Groups of entity ids that belong on one page, largest first, plus the ids that touch nothing.
 * A group bigger than MAX_GROUP is usually held together by one table everything points at
 * (users, companies): that hub is cut out and copied onto every page that links to it.
 */
export function erGroups(model, maxGroup = MAX_GROUP) {
  const ids = [...entityMap(model).values()].map((e) => e.id);
  const rels = model.relationships.filter((r) => r.entityA !== r.entityB);
  const hubs = new Set();
  const degree = (id) => rels.filter((r) => !hubs.has(r.entityA) && !hubs.has(r.entityB) && (r.entityA === id || r.entityB === id)).length;

  const components = () => {
    const parent = new Map(ids.filter((i) => !hubs.has(i)).map((id) => [id, id]));
    const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
    const linked = new Set();
    for (const r of rels) {
      if (hubs.has(r.entityA) || hubs.has(r.entityB)) continue;
      parent.set(find(r.entityA), find(r.entityB));
      linked.add(r.entityA).add(r.entityB);
    }
    const groups = new Map();
    for (const id of parent.keys()) if (linked.has(id)) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
    return { groups: [...groups.values()].sort((a, b) => b.length - a.length) };
  };

  let { groups } = components();
  while (groups[0]?.length > maxGroup) {
    const hub = [...groups[0]].sort((a, b) => degree(b) - degree(a))[0];
    if (degree(hub) < 3) break; // no clear hub: keep the big page rather than cut at random
    hubs.add(hub);
    ({ groups } = components());
  }
  // tables whose only links went to a hub: one page per hub, in chunks of maxGroup
  const touches = (id, h) => rels.some((r) => (r.entityA === h && r.entityB === id) || (r.entityB === h && r.entityA === id));
  const placed = new Set(groups.flat());
  for (const h of hubs) {
    const spokes = ids.filter((id) => !hubs.has(id) && !placed.has(id) && touches(id, h));
    spokes.forEach((id) => placed.add(id));
    for (let i = 0; i < spokes.length; i += maxGroup) groups.push(spokes.slice(i, i + maxGroup));
  }
  // each page also shows the hubs its tables point at, so no relationship is lost
  const withHubs = groups.map((g) => {
    const used = [...hubs].filter((h) => rels.some((r) => (r.entityA === h && g.includes(r.entityB)) || (r.entityB === h && g.includes(r.entityA))));
    return { ids: [...g, ...used], hubs: used };
  });
  const hubAlone = [...hubs].filter((h) => !withHubs.some((g) => g.hubs.includes(h)));
  return {
    groups: withHubs,
    alone: [...ids.filter((i) => !hubs.has(i) && !placed.has(i)), ...hubAlone],
    hubs: [...hubs],
  };
}

function entityMap(model) {
  return model.entities instanceof Map ? model.entities : new Map(Object.entries(model.entities));
}

/** Rebuild Mermaid for just these entities and the relationships among them. */
function toMermaid(model, keep, direction) {
  const byId = new Map([...entityMap(model)].map(([name, e]) => [e.id, { name, ...e }]));
  const lines = ['erDiagram'];
  if (direction) lines.push(`  direction ${direction}`);
  for (const id of keep) {
    const e = byId.get(id);
    const head = e.label && e.label !== e.name ? `${e.name}[${quote(e.label)}]` : e.name;
    if (!e.attributes.length) { lines.push(`  ${head} { }`); continue; }
    lines.push(`  ${head} {`);
    for (const a of e.attributes) {
      lines.push(`    ${a.type} ${a.name}${a.keys.length ? ` ${a.keys.join(',')}` : ''}${a.comment ? ` ${quote(a.comment)}` : ''}`);
    }
    lines.push('  }');
  }
  const inside = new Set(keep);
  for (const r of model.relationships) {
    if (!inside.has(r.entityA) || !inside.has(r.entityB)) continue;
    const dash = r.relSpec.relType === 'IDENTIFYING' ? '--' : '..';
    lines.push(`  ${byId.get(r.entityA).name} ${LEFT[r.relSpec.cardB]}${dash}${RIGHT[r.relSpec.cardA]} ${byId.get(r.entityB).name} : ${quote(r.roleA || ' ')}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * One source per page. A model that is already one group (or has no relationships)
 * comes back unchanged so nothing about it moves.
 */
export function splitEr(src) {
  if (!/^\s*erDiagram\b/m.test(src)) return [{ src }];
  const model = parse(src);
  const { groups, alone } = erGroups(model);
  if (groups.length + (alone.length ? 1 : 0) <= 1) return [{ src }];
  const direction = src.match(/^\s*direction\s+(\w+)/m)?.[1];
  const byId = new Map([...entityMap(model).values()].map((e) => [e.id, e]));
  const degree = (id) => model.relationships.filter((r) => r.entityA !== r.entityB && (r.entityA === id || r.entityB === id)).length;
  const pages = groups.map((g) => {
    const own = g.ids.filter((id) => !g.hubs.includes(id));
    const hub = [...own].sort((a, b) => degree(b) - degree(a))[0];
    const shared = g.hubs.length ? ` + ${g.hubs.length} ตารางที่ใช้ร่วม` : '';
    // the page's own main table gets the accent, not a shared hub copied onto it
    const src = toMermaid(model, g.ids, direction).replace('erDiagram\n', `erDiagram\n  %% focal: ${byId.get(hub).label}\n`);
    return { name: `${byId.get(hub).label} (${own.length} ตาราง${shared})`, src };
  });
  if (alone.length) pages.push({ name: `ตารางที่ไม่มีความสัมพันธ์ (${alone.length})`, src: toMermaid(model, alone, direction) });
  return pages;
}
