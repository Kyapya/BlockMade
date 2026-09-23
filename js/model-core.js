/* BlockMade model core — pure data functions shared by the browser app and
   the command-line tools (node tools/validate.mjs). No DOM, no Three.js. */
(function (root) {
'use strict';

/** Standard palette. Models carry their own `colors`, but AI-generated models
 *  and hand-written ones may simply reference these keys. */
const STANDARD_COLORS = {
  'white':       { name: 'White',       hex: '#f0efe9' },
  'light-gray':  { name: 'Light Gray',  hex: '#a8afb7' },
  'dark-gray':   { name: 'Dark Gray',   hex: '#59616b' },
  'black':       { name: 'Black',       hex: '#25282d' },
  'red':         { name: 'Red',         hex: '#b23a30' },
  'dark-red':    { name: 'Dark Red',    hex: '#7a2426' },
  'orange':      { name: 'Orange',      hex: '#e0772b' },
  'yellow':      { name: 'Yellow',      hex: '#f2cd37' },
  'gold':        { name: 'Gold',        hex: '#d8a83c', metalness: 0.35, roughness: 0.34 },
  'tan':         { name: 'Tan',         hex: '#d6b97c' },
  'brown':       { name: 'Brown',       hex: '#6e452b' },
  'green':       { name: 'Green',       hex: '#2e8b50' },
  'dark-green':  { name: 'Dark Green',  hex: '#1f5a3a' },
  'lime':        { name: 'Lime',        hex: '#a5c63b' },
  'blue':        { name: 'Blue',        hex: '#2f63b8' },
  'dark-blue':   { name: 'Dark Blue',   hex: '#223b66' },
  'sky-blue':    { name: 'Sky Blue',    hex: '#62b0e0' },
  'purple':      { name: 'Purple',      hex: '#6c4aa8' },
  'pink':        { name: 'Pink',        hex: '#e58ab5' },
  'trans-blue':  { name: 'Trans Blue',  hex: '#7cc3f0', opacity: 0.55 },
  'trans-clear': { name: 'Trans Clear', hex: '#e8f2f6', opacity: 0.45 },
  'trans-red':   { name: 'Trans Red',   hex: '#ff4a3d', opacity: 0.7 },
  'trans-orange':{ name: 'Trans Orange',hex: '#ff9b2e', opacity: 0.7 },
  'trans-yellow':{ name: 'Trans Yellow',hex: '#ffe45c', opacity: 0.7 },
  'trans-green': { name: 'Trans Green', hex: '#5fe07a', opacity: 0.6 }
};

/** Real-world brick footprints the designer (human or AI) may use. */
const BRICK_SIZES = [[1,1],[1,2],[1,3],[1,4],[1,6],[1,8],[2,2],[2,3],[2,4],[2,6],[2,8],[2,10],[2,12],[4,4],[4,6]];

function toInt(v, name, where) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.round(n) !== n) throw new Error(`${where} の "${name}" は整数である必要があります（値: ${JSON.stringify(v)}）`);
  return n;
}

function normalizeModel(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('JSONのトップレベルはオブジェクトである必要があります。');
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) throw new Error('"blocks" 配列（1個以上）が必要です。');
  const warnings = [];
  const colors = {};
  for (const [k, c] of Object.entries(raw.colors || {})) {
    if (!c || typeof c.hex !== 'string') { warnings.push(`色 "${k}" に hex がありません。`); continue; }
    colors[k] = { name: c.name || k, hex: c.hex, opacity: c.opacity ?? 1, metalness: c.metalness ?? 0.03, roughness: c.roughness ?? 0.42 };
  }
  const ids = new Set();
  const blocks = raw.blocks.map((b, i) => {
    const where = `blocks[${i}]`;
    if (!b || typeof b !== 'object') throw new Error(`${where} がオブジェクトではありません。`);
    for (const k of ['id', 'width', 'depth', 'x', 'y', 'z', 'color', 'step']) {
      if (b[k] === undefined || b[k] === null) throw new Error(`${where} に "${k}" がありません。`);
    }
    const id = String(b.id);
    if (ids.has(id)) throw new Error(`ブロックID "${id}" が重複しています。`);
    ids.add(id);
    const width = toInt(b.width, 'width', id), depth = toInt(b.depth, 'depth', id);
    const height = toInt(b.height ?? 1, 'height', id);
    if (width < 1 || depth < 1 || height < 1) throw new Error(`${id}: width / depth / height は1以上にしてください。`);
    const rotation = ((toInt(b.rotation ?? 0, 'rotation', id) % 360) + 360) % 360;
    if (rotation % 90 !== 0) throw new Error(`${id}: rotation は 0 / 90 / 180 / 270 のいずれかです。`);
    const swap = rotation === 90 || rotation === 270;
    const color = String(b.color);
    if (!colors[color]) {
      const std = STANDARD_COLORS[color];
      if (std) colors[color] = { name: std.name, hex: std.hex, opacity: std.opacity ?? 1, metalness: std.metalness ?? 0.03, roughness: std.roughness ?? 0.42 };
      else if (/^#[0-9a-f]{3,8}$/i.test(color)) colors[color] = { name: color, hex: color, opacity: 1, metalness: 0.03, roughness: 0.42 };
      else { warnings.push(`${id}: 色 "${color}" が定義されていないため仮の色で表示します。`); colors[color] = { name: color, hex: '#ff4fd8', opacity: 1, metalness: 0, roughness: 0.5 }; }
    }
    const numMatch = id.match(/(\d+)\s*$/);
    return {
      id, type: b.type ? String(b.type) : `${width}x${depth}${height !== 1 ? 'x' + height : ''}`,
      width, depth, height,
      x: toInt(b.x, 'x', id), y: toInt(b.y, 'y', id), z: toInt(b.z, 'z', id),
      rotation, color, step: toInt(b.step, 'step', id),
      print: b.print && typeof b.print === 'object' ? { pattern: String(b.print.pattern || ''), face: String(b.print.face || '+z') } : null,
      sx: swap ? depth : width, sz: swap ? width : depth, h: height,
      num: numMatch ? parseInt(numMatch[1], 10) : i + 1, index: i
    };
  });
  const metaByStep = new Map();
  for (const s of (Array.isArray(raw.steps) ? raw.steps : [])) if (s && s.step !== undefined) metaByStep.set(Number(s.step), s);
  const stepNums = [...new Set(blocks.map(b => b.step))].sort((a, b) => a - b);
  const steps = stepNums.map(n => {
    const m = metaByStep.get(n) || {};
    return { step: n, title: m.title || `Step ${n}`, description: m.description || '' };
  });
  for (const n of metaByStep.keys()) if (!stepNums.includes(n)) warnings.push(`Step ${n} には追加ブロックがありません。`);
  const layers = Math.max(...blocks.map(b => b.y + b.h));
  const minX = Math.min(...blocks.map(b => b.x)), maxX = Math.max(...blocks.map(b => b.x + b.sx));
  const minZ = Math.min(...blocks.map(b => b.z)), maxZ = Math.max(...blocks.map(b => b.z + b.sz));
  return {
    format: 'blockmade.model', version: 1,
    name: String(raw.name || 'Untitled'), nameEn: raw.nameEn ? String(raw.nameEn) : '',
    description: String(raw.description || ''),
    author: raw.author ? String(raw.author) : '',
    prompt: raw.prompt ? String(raw.prompt) : '',
    createdAt: raw.createdAt ? String(raw.createdAt) : '',
    colors, steps, blocks, warnings, layers,
    bounds: { minX, maxX, minZ, maxZ },
    byId: new Map(blocks.map(b => [b.id, b]))
  };
}

const overlapXZ = (a, b) => a.x < b.x + b.sx && b.x < a.x + a.sx && a.z < b.z + b.sz && b.z < a.z + a.sz;
const overlapY = (a, b) => a.y < b.y + b.h && b.y < a.y + a.h;

/** Structure checks: connection, support, collision, build order. */
function validateModel(m) {
  const B = m.blocks, n = B.length;
  const above = new Map(B.map(b => [b.id, []])), below = new Map(B.map(b => [b.id, []]));
  const collisions = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = B[i], b = B[j];
    if (!overlapXZ(a, b)) continue;
    if (overlapY(a, b)) { collisions.push([a.id, b.id]); continue; }
    if (a.y === b.y + b.h) { below.get(a.id).push(b.id); above.get(b.id).push(a.id); }
    else if (b.y === a.y + a.h) { below.get(b.id).push(a.id); above.get(a.id).push(b.id); }
  }
  const neighbours = id => [...above.get(id), ...below.get(id)];

  const seen = new Set(), groups = [];
  for (const b of B) {
    if (seen.has(b.id)) continue;
    const comp = [], q = [b.id]; seen.add(b.id);
    while (q.length) { const id = q.pop(); comp.push(id); for (const nb of neighbours(id)) if (!seen.has(nb)) { seen.add(nb); q.push(nb); } }
    groups.push(comp);
  }
  groups.sort((a, b) => b.length - a.length);

  const grounded = new Set(), q = [];
  for (const b of B) if (b.y === 0) { grounded.add(b.id); q.push(b.id); }
  while (q.length) { const id = q.pop(); for (const nb of neighbours(id)) if (!grounded.has(nb)) { grounded.add(nb); q.push(nb); } }
  const floating = B.filter(b => !grounded.has(b.id)).map(b => b.id);
  const belowGround = B.filter(b => b.y < 0).map(b => b.id);

  const placed = new Set(), orderIssues = [];
  for (const s of m.steps) {
    let pending = B.filter(b => b.step === s.step);
    let progress = true;
    while (pending.length && progress) {
      progress = false;
      const next = [];
      for (const b of pending) {
        const pb = below.get(b.id).filter(id => placed.has(id));
        const pa = above.get(b.id).filter(id => placed.has(id));
        if (b.y === 0 || pb.length || pa.length) {
          if ((b.y === 0 || pb.length) && pa.length) orderIssues.push({ step: s.step, id: b.id, msg: `上下がすでに組まれていて差し込めません（上: ${pa.join(', ')}）` });
          placed.add(b.id); progress = true;
        } else next.push(b);
      }
      pending = next;
    }
    for (const b of pending) { orderIssues.push({ step: s.step, id: b.id, msg: 'この時点で接続先がなく、宙に浮きます' }); placed.add(b.id); }
  }

  const res = {
    connected: { ok: groups.length === 1, groups },
    supported: { ok: floating.length === 0 && belowGround.length === 0, floating, belowGround },
    collisions: { ok: collisions.length === 0, pairs: collisions },
    order: { ok: orderIssues.length === 0, issues: orderIssues },
    above, below
  };
  res.allOk = res.connected.ok && res.supported.ok && res.collisions.ok && res.order.ok;
  res.failCount = [res.connected, res.supported, res.collisions, res.order].filter(c => !c.ok).length;
  return res;
}

/** Plain-language list of problems, for humans and for an AI repair prompt. */
function describeIssues(m, c, max = 40) {
  const out = [];
  const fmt = id => { const b = m.byId.get(id); return `${id}(${b.type} x${b.x} y${b.y} z${b.z} step${b.step})`; };
  if (!c.collisions.ok) for (const [a, b] of c.collisions.pairs) out.push(`COLLISION: ${fmt(a)} と ${fmt(b)} が同じ空間を占有`);
  if (!c.supported.ok) for (const id of c.supported.floating) out.push(`FLOATING: ${fmt(id)} は地面までつながっていない`);
  if (!c.connected.ok) for (const g of c.connected.groups.slice(1)) out.push(`DISCONNECTED GROUP: ${g.slice(0, 8).join(', ')}${g.length > 8 ? ' …' : ''} が本体と接続されていない`);
  if (!c.order.ok) for (const is of c.order.issues) out.push(`BUILD ORDER: ${fmt(is.id)} — ${is.msg}`);
  return out.slice(0, max);
}

/** Deterministic repairs for common generator mistakes:
 *  drop the later block of each colliding pair, drop blocks that cannot reach
 *  the ground, then renumber steps so every block can be placed when its step
 *  comes (bottom-up within the original step order). Returns a new raw model. */
function autoRepair(raw) {
  let r = JSON.parse(JSON.stringify(raw));
  const removed = [];
  for (let pass = 0; pass < 3; pass++) {
    const m = normalizeModel(r), c = validateModel(m);
    const drop = new Set();
    for (const [a, b] of c.collisions.pairs) { if (!drop.has(a)) drop.add(b); }
    for (const id of c.supported.floating) drop.add(id);
    if (!drop.size) break;
    r.blocks = r.blocks.filter(b => !drop.has(String(b.id)));
    removed.push(...drop);
    if (!r.blocks.length) throw new Error('修復後にブロックが残りませんでした。');
  }
  let m = normalizeModel(r), c = validateModel(m);
  if (!c.order.ok) {
    // Re-sequence: walk the steps; blocks that cannot be placed yet move to the
    // earliest later step where they attach. Sandwich cases move the upper block later.
    const meta = new Map(m.steps.map(s => [s.step, s]));
    const stepOf = new Map(m.blocks.map(b => [b.id, b.step]));
    for (let guard = 0; guard < 20 && !c.order.ok; guard++) {
      const maxStep = Math.max(...m.steps.map(s => s.step));
      for (const is of c.order.issues) {
        if (is.msg.startsWith('上下')) {
          const upper = c.above.get(is.id).map(id => m.byId.get(id)).filter(Boolean);
          for (const u of upper) stepOf.set(u.id, Math.max(stepOf.get(u.id), stepOf.get(is.id) + 1));
        } else stepOf.set(is.id, Math.min(maxStep + 1, stepOf.get(is.id) + 1));
      }
      r.blocks.forEach(b => { b.step = stepOf.get(String(b.id)); });
      m = normalizeModel({ ...r, steps: [...meta.values()] });
      c = validateModel(m);
    }
    const used = [...new Set(r.blocks.map(b => b.step))].sort((a, b) => a - b);
    const remap = new Map(used.map((s, i) => [s, i + 1]));
    r.blocks.forEach(b => { b.step = remap.get(b.step); });
    r.steps = used.map((s, i) => ({ step: i + 1, title: (meta.get(s) || {}).title || `Step ${i + 1}`, description: (meta.get(s) || {}).description || '' }));
  }
  return { raw: r, removed };
}

/** Convert the compact array format the AI writes into a full model.
 *  blocks: [w, d, h, x, y, z, rotation, colorKey, step, printFace?] */
function fromCompact(c, extra = {}) {
  if (!c || !Array.isArray(c.blocks)) throw new Error('AIの出力に blocks 配列がありません。');
  const blocks = c.blocks.map((a, i) => {
    if (!Array.isArray(a) || a.length < 9) throw new Error(`blocks[${i}] の形式が不正です。`);
    const [w, d, h, x, y, z, rot, color, step, face] = a;
    const b = { id: `block_${String(i + 1).padStart(3, '0')}`, width: w, depth: d, height: h || 1, x, y, z, rotation: rot || 0, color: String(color), step };
    b.type = `${w}x${d}${(h || 1) !== 1 ? 'x' + h : ''}`;
    if (face && /^[+-][xz]$/.test(face)) b.print = { pattern: 'clock', face };
    return b;
  });
  const used = new Set(blocks.map(b => b.color));
  const colors = {};
  for (const k of used) if (STANDARD_COLORS[k]) colors[k] = STANDARD_COLORS[k];
  return {
    format: 'blockmade.model', version: 1,
    name: String(c.name || extra.name || '新しい作品'), nameEn: String(c.nameEn || ''),
    description: String(c.description || ''),
    author: extra.author || '', prompt: extra.prompt || '', createdAt: extra.createdAt || '',
    colors, steps: Array.isArray(c.steps) ? c.steps : [], blocks
  };
}

function cleanBlock(b) {
  const o = { id: b.id, type: b.type, width: b.width, depth: b.depth, height: b.height, x: b.x, y: b.y, z: b.z, rotation: b.rotation, color: b.color, step: b.step };
  if (b.print) o.print = b.print;
  return o;
}
function modelToJSON(m) {
  const colors = {};
  for (const [k, c] of Object.entries(m.colors)) {
    const o = { name: c.name, hex: c.hex };
    if (c.opacity !== 1) o.opacity = c.opacity;
    if (c.metalness !== 0.03) o.metalness = c.metalness;
    if (c.roughness !== 0.42) o.roughness = c.roughness;
    colors[k] = o;
  }
  const out = { format: 'blockmade.model', version: 1, name: m.name, nameEn: m.nameEn, description: m.description };
  if (m.author) out.author = m.author;
  if (m.prompt) out.prompt = m.prompt;
  if (m.createdAt) out.createdAt = m.createdAt;
  Object.assign(out, { colors, steps: m.steps, blocks: '__BLOCKS__' });
  const lines = m.blocks.map(b => '    ' + JSON.stringify(cleanBlock(b))).join(',\n');
  return JSON.stringify(out, null, 2).replace('"__BLOCKS__"', '[\n' + lines + '\n  ]') + '\n';
}

const api = { STANDARD_COLORS, BRICK_SIZES, normalizeModel, validateModel, describeIssues, autoRepair, fromCompact, modelToJSON, cleanBlock, overlapXZ, overlapY };
// Always expose the browser global; also export for node (tools/*.mjs).
root.BlockModel = api;
if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
