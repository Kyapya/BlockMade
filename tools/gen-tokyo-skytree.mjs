// Generates models/tokyo-skytree.json — a large, lattice-accurate Tokyo Skytree.
//   node tools/gen-tokyo-skytree.mjs            (then: node tools/validate.mjs && node tools/build.mjs)
//   DEBUG_Y=23,26 node tools/gen-tokyo-skytree.mjs   prints plan-view maps of those plate levels
//
// Scale: 1 stud = 2 m, 1 plate = 0.8 m (one brick course = 2.4 m), so the 634 m tower
// stands about 793 plates tall on a 64 × 72 stud plaza.
//
// Pipeline
//   1. plan    — for every brick course, the plan-view cells of the tower (triangle → circle
//                outline, diagrid lattice, legs, core, shafts, deck and galleria), plus
//                plate-level "sheets" for floors, glass bands and roofs.
//   2. closure — bottom-up pass that guarantees every lattice cell can clip onto something:
//                a cell with no stud below (directly, or along a straight run that fits one
//                brick) gets the cell beneath it filled in, else it is removed.
//   3. pack    — each layer is covered with real parts (most-constrained cell first), every
//                part covering at least one stud below; floor plates may instead hang from
//                the staggered plate layer above.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = require(join(root, 'js/model-core.js'));
const { PARTS } = core;

/* ------------------------------------------------------------------ scale */
const M_PLATE = 0.8, M_COURSE = 2.4;
const Y0 = 2;                                   // tower ground = top of the two plaza plate layers
const yOfCourse = L => Y0 + 3 * L;
const mOfCourse = L => (L + 0.5) * M_COURSE;     // metres at mid-course
const yOfM = m => Y0 + Math.round(m / M_PLATE);
const mOfY = y => (y - Y0 + 0.5) * M_PLATE;
const TC = { x: 0, z: -8 };                      // tower axis (a stud-grid corner)

/* ------------------------------------------------------------------ cells */
const OFF = 512;
const key = (x, z) => (x + OFF) * 1024 + (z + OFF);
const kx = k => Math.floor(k / 1024) - OFF;
const kz = k => (k % 1024) - OFF;
const rel = (x, z) => [x + 0.5 - TC.x, z + 0.5 - TC.z];
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const disk = t => { const o = []; for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if ((dx || dz) && dx * dx + dz * dz <= t * t + 1e-9) o.push([dx, dz]); return o; };

/* ----------------------------------------------------------- tower plan shape */
// Plan: an equilateral triangle (side 68 m) at the foot that rounds into a circle by 320 m.
// Side normals point +Z (front) and ±120°; the three legs sit at 30°, 150° and 270°.
const SIDE_N = [90, 210, 330].map(d => d * Math.PI / 180);
const VERT = [30, 150, 270].map(d => d * Math.PI / 180);
const TRI_MEAN = 1.2576;                         // mean of sec(φ) over ±60°
const fTri = th => 1 / Math.max(...SIDE_N.map(n => Math.cos(th - n))) / TRI_MEAN;
function lerpTable(t, m) {
  if (m <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (m <= t[i][0]) { const [a, ra] = t[i - 1], [b, rb] = t[i]; return ra + (rb - ra) * (m - a) / (b - a); }
  return t[t.length - 1][1];
}
/** Outer radius (studs) of the tower body at plan angle th and height m (metres). */
function bodyR(th, m) {
  if (m <= 320) {
    const u = m / 320;
    const R = 8.25 + 4.09 * Math.pow(1 - u, 1.25);   // "sori": concave taper, 68 m triangle -> 33 m circle
    const w = Math.pow(1 - u, 1.1);                   // triangle -> circle morph
    return R * (w * fTri(th) + 1 - w);
  }
  if (m <= 332) return 8.25 - (m - 320) * 0.004;
  if (m <= 440) return 8.1 - Math.max(0, m - 360) * 0.005;           // between the two observatories
  return lerpTable([[440, 7.7], [461, 7.5], [470, 7.2], [478, 6.4], [485, 5.2], [490, 4.1], [494, 3.1], [497, 2.6]], m);
}
const circ = R => () => R;

/* ------------------------------------------------------------ course plan */
// kinds: podium | podiumroof | lattice | deckbase | slab | flare | deckwall | galwall | roof | disk
const COURSES = [];
const put = (from, to, f) => { for (let L = from; L <= to; L++) COURSES[L] = f(L); };
const LAT = (L0, P) => L => ({ kind: 'lattice', r: th => bodyR(th, mOfCourse(L)), L0: L0 + Math.floor((L - L0) / P) * P, P });
put(0, 3, L => ({ kind: 'podium', r: th => bodyR(th, mOfCourse(L)) }));
put(4, 4, L => ({ kind: 'podiumroof', r: th => bodyR(th, mOfCourse(L)) }));
put(5, 137, LAT(5, 7));                                            // 12–331 m, ring truss every 16.8 m
put(138, 138, L => ({ kind: 'lattice', r: th => bodyR(th, mOfCourse(L)), L0: 138, P: 7 }));
put(139, 139, () => ({ kind: 'deckbase', r: circ(9.0), rIn: 8.2 })); // Tembo Deck: floor disk on the ring truss
put(140, 140, () => ({ kind: 'slab', r: circ(9.8) }));            //   bottom slab, flared with inverted slopes
put(141, 141, () => ({ kind: 'flare', r: circ(10.6), rIn: 9.8 })); //   flare ring + floor 340
put(142, 147, () => ({ kind: 'deckwall', r: circ(10.6) }));        //   glass, floors 345 / 350, ceiling
put(148, 148, () => ({ kind: 'roof', r: circ(10.6), next: 9.5 }));
put(149, 149, () => ({ kind: 'roof', r: circ(9.5) }));
put(150, 182, LAT(150, 8));                                        // 360–440 m
put(183, 183, () => ({ kind: 'deckbase', r: circ(8.4), rIn: 7.7 })); // Tembo Galleria
put(184, 184, () => ({ kind: 'flare', r: circ(9.1), rIn: 8.4 }));
put(185, 190, () => ({ kind: 'galwall', r: circ(9.1) }));
put(191, 191, () => ({ kind: 'roof', r: circ(9.1), next: 8.2 }));
put(192, 192, () => ({ kind: 'roof', r: circ(8.2) }));
put(193, 205, LAT(193, 7));                                        // 461–494 m, tapering to the gain tower
put(206, 206, L => ({ kind: 'disk', r: th => bodyR(th, mOfCourse(L)) }));
const LAST_BODY = 206;

// interior columns: 心柱 (reinforced-concrete core, Ø8 m, to 375 m) and three elevator shafts
const CORE_TOP = 156;                                             // course containing 375 m
const coreCells = new Set();
for (let x = -2; x < 2; x++) for (let z = -2; z < 2; z++) if (!((x === -2 || x === 1) && (z === -2 || z === 1))) coreCells.add(key(TC.x + x, TC.z + z));
const SHAFTS = [
  { x: -1, z: 3, top: 190 },   // front — Tembo Deck & Tembo Shuttle
  { x: -4, z: -3, top: 190 },  // back-left
  { x: 2, z: -3, top: 147 }    // back-right — Tembo Deck only
].map(s => ({ ...s, cells: [key(TC.x + s.x, TC.z + s.z), key(TC.x + s.x + 1, TC.z + s.z), key(TC.x + s.x, TC.z + s.z + 1), key(TC.x + s.x + 1, TC.z + s.z + 1)] }));
function columnCells(L) {
  const out = new Map();
  if (L <= CORE_TOP) for (const k of coreCells) out.set(k, 'concrete');
  for (const s of SHAFTS) if (L <= s.top) for (const k of s.cells) out.set(k, 'steel');
  return out;
}

/* ------------------------------------------------------------ geometry sets */
const SCAN = 24;
function insideSet(rFn) {
  const s = new Set();
  for (let x = TC.x - SCAN; x < TC.x + SCAN; x++) for (let z = TC.z - SCAN; z < TC.z + SCAN; z++) {
    const [px, pz] = rel(x, z);
    if (Math.hypot(px, pz) < rFn(Math.atan2(pz, px))) s.add(key(x, z));
  }
  return s;
}
/** Wall band: inside cells within distance t of the outside (a morphological edge). */
function bandSet(inside, t) {
  const off = disk(t), s = new Set();
  for (const k of inside) { const x = kx(k), z = kz(k); if (off.some(([dx, dz]) => !inside.has(key(x + dx, z + dz)))) s.add(k); }
  return s;
}
const ringSet = inside => bandSet(inside, 1.5);        // 1 cell thick, 4-connected
const insideCache = new Map();
const insideOf = L => { if (!insideCache.has(L)) insideCache.set(L, COURSES[L] ? insideSet(COURSES[L].r) : new Set()); return insideCache.get(L); };
const bandCache = new Map();
const bandOf = L => { if (!bandCache.has(L)) bandCache.set(L, bandSet(insideOf(L), 2)); return bandCache.get(L); };

/** Lattice pattern: X-braced diagrid panels between horizontal ring trusses.
 *  Panels are laid out by arc length along the plan outline (evenly spaced on the
 *  triangle's flat sides); the panel count is fixed per ring section. */
function arcFn(rFn) {
  const n = 720, cum = [0];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const th = VERT[0] + i / n * 2 * Math.PI, r = rFn(th), p = [r * Math.cos(th), r * Math.sin(th)];
    if (prev) cum.push(cum[cum.length - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  const total = cum[n];
  const f = th => { let t = ((th - VERT[0]) / (2 * Math.PI)) % 1; if (t < 0) t += 1; const g = t * n, i = Math.floor(g); return (cum[i] + (cum[Math.min(n, i + 1)] - cum[i]) * (g - i)) / total; };
  f.total = total;
  return f;
}
const PANEL = 8.6;                                  // target panel width in studs (≈ 17 m)
const sectionN = new Map();
function panelsFor(L0, P) {
  if (!sectionN.has(L0)) {
    const mid = Math.min(L0 + Math.floor(P / 2), COURSES.length - 1);
    const len = arcFn(COURSES[mid].r).total;
    sectionN.set(L0, len < 20 ? 0 : 3 * Math.max(1, Math.round(len / PANEL / 3)));
  }
  return sectionN.get(L0);
}
function latticeOpen(c, L, th, arc) {
  const dL = L - c.L0;
  if (dL <= 0 || dL >= c.P) return false;
  const N = panelsFor(c.L0, c.P);
  if (!N) return false;
  const s = arc(th) * 8 * N + 4;                                     // X crossings sit on the leg lines
  const ds0 = Math.abs(s - 8 * Math.round(s / 8));
  const ds4 = Math.abs(s - 4 - 8 * Math.round((s - 4) / 8));
  const a = 3.0, b = c.P / 2 - 1;
  return ds0 / a + Math.abs(dL - c.P / 2) / b <= 1 || ds4 / a + dL / b <= 1 || ds4 / a + (c.P - dL) / b <= 1;
}
/** The three corner legs (the tripartite truss) — solid, thinning out by ~150 m. */
function legWidth(L) { const m = mOfCourse(L); return m > 150 ? 0 : 3.6 - 2.0 * m / 150; }
function inLeg(px, pz, L) {
  const w = legWidth(L);
  if (!w) return false;
  return VERT.some(v => { const along = px * Math.cos(v) + pz * Math.sin(v), perp = Math.abs(-px * Math.sin(v) + pz * Math.cos(v)); return along > 3 && perp <= w / 2; });
}

/* ================================================================== parts */
const parts = [];
const occ = new Map();          // y -> Set(cell) occupied
const studs = new Map();        // y -> Map(cell -> part index): studs pointing up at height y
const dropped = [];
const occAt = y => { if (!occ.has(y)) occ.set(y, new Set()); return occ.get(y); };
const studAt = y => { if (!studs.has(y)) studs.set(y, new Map()); return studs.get(y); };
const isFree = (y, h, cells) => cells.every(k => { for (let i = 0; i < h; i++) if (occ.get(y + i)?.has(k)) return false; return true; });
const supportIdx = (y, k) => studs.get(y)?.get(k);

/** Add a part given its world footprint (sx × sz studs). Without an explicit rotation,
 *  the listed real size is used as-is, or turned 90° when only the swapped size exists. */
function addPart(shape, sx, sz, x, y, z, color, { rotation = null, h = null } = {}) {
  const P = PARTS[shape];
  const height = h ?? P.heights[0];
  let width, depth, rot;
  if (rotation !== null) { rot = rotation; const sw = rot === 90 || rot === 270; width = sw ? sz : sx; depth = sw ? sx : sz; }
  else if (P.sizes.some(([w, d]) => w === sx && d === sz)) { width = sx; depth = sz; rot = 0; }
  else { width = sz; depth = sx; rot = 90; }
  const b = { shape, width, depth, height, x, y, z, rotation: rot, color };
  const nb = core.normalizeModel({ version: 2, blocks: [{ id: 'p', ...b, step: 1 }] }).blocks[0];
  const cells = [];
  for (let i = 0; i < nb.sx; i++) for (let j = 0; j < nb.sz; j++) cells.push(key(x + i, z + j));
  if (!isFree(y, height, cells)) throw new Error(`collision: ${shape} ${sx}x${sz} at ${x},${y},${z}`);
  const idx = parts.length;
  parts.push(b);
  for (let i = 0; i < height; i++) { const o = occAt(y + i); for (const k of cells) o.add(k); }
  const st = studAt(y + height);
  for (const [cx, cz] of nb.topCells) st.set(key(cx, cz), idx);
  return idx;
}

/* --------------------------------------------------------------- packer */
function sizeList(shape) {
  const out = [], seen = new Set();
  for (const [w, d] of PARTS[shape].sizes) for (const [a, b] of [[w, d], [d, w]]) { const k = a + 'x' + b; if (!seen.has(k)) { seen.add(k); out.push([a, b]); } }
  return out;
}
const SIZES = { brick: sizeList('brick'), plate: sizeList('plate'), tile: sizeList('tile') };
const fits1 = (shape, n) => SIZES[shape].some(([a, b]) => a === 1 && b === n);

/**
 * Cover a set of same-colour cells at height y with parts of one shape.
 * Every part must cover at least one stud below, unless hang = true (floor plates tied
 * together by the plate layer above). The most constrained cell is covered first, with
 * its best option: big parts that bridge several parts below, orientation alternating
 * by layer for a woven bond.
 */
function pack(cellsIn, y, shape, color, { hang = false } = {}) {
  const h = shape === 'brick' ? 3 : 1;
  const cells = new Set([...cellsIn].filter(k => isFree(y, h, [k])));
  const parity = (y % 2) === 0;
  const cands = [], byCell = new Map([...cells].map(k => [k, []]));
  for (const k of cells) {
    const x = kx(k), z = kz(k);
    for (const [a, b] of SIZES[shape]) {
      const rc = [];
      let ok = true;
      for (let i = 0; i < a && ok; i++) for (let j = 0; j < b; j++) { const kk = key(x + i, z + j); if (!cells.has(kk)) { ok = false; break; } rc.push(kk); }
      if (!ok) continue;
      const below = new Set();
      for (const kk of rc) { const s = supportIdx(y, kk); if (s !== undefined) below.add(s); }
      if (!below.size && !hang) continue;
      const bridgeW = shape === 'brick' ? 30 : 150;
      const score = (below.size ? 1e6 : 0) + a * b * 10 + Math.min(below.size, 4) * bridgeW + ((a >= b) === parity ? 4 : 0);
      const ci = cands.length;
      cands.push({ x, z, a, b, rc, score, alive: true });
      for (const kk of rc) byCell.get(kk).push(ci);
    }
  }
  const cnt = new Map([...byCell].map(([k, l]) => [k, l.length]));
  const covered = new Set(), placed = [];
  const kill = ci => { const c = cands[ci]; if (!c.alive) return; c.alive = false; for (const kk of c.rc) cnt.set(kk, cnt.get(kk) - 1); };
  for (;;) {
    let best = null, bc = Infinity;
    for (const k of cells) if (!covered.has(k)) { const n = cnt.get(k); if (n > 0 && n < bc) { bc = n; best = k; if (n === 1) break; } }
    if (best === null) break;
    let bi = -1;
    for (const ci of byCell.get(best)) if (cands[ci].alive && (bi < 0 || cands[ci].score > cands[bi].score)) bi = ci;
    const c = cands[bi];
    placed.push(c);
    for (const kk of c.rc) { covered.add(kk); for (const cj of byCell.get(kk)) kill(cj); }
  }
  // repair: a stranded cell joins a neighbouring 1-wide run, splitting it if needed
  for (const u of [...cells].filter(k => !covered.has(k))) {
    const ux = kx(u), uz = kz(u);
    let done = false;
    for (const [dx, dz] of N4) {
      if (done) break;
      const nk = key(ux + dx, uz + dz);
      const pi = placed.findIndex(p => p.rc.includes(nk));
      if (pi < 0) continue;
      const p = placed[pi], alongX = dx !== 0;
      if ((alongX && p.b !== 1) || (!alongX && p.a !== 1)) continue;
      const run = [...p.rc].sort((k1, k2) => alongX ? (kx(k1) - kx(k2)) * dx : (kz(k1) - kz(k2)) * dz);
      if (run[0] !== nk) continue;
      for (let kk = run.length; kk >= 1 && !done; kk--) {
        const A = [u, ...run.slice(0, kk)], B = run.slice(kk);
        if (!fits1(shape, A.length) || (B.length && !fits1(shape, B.length))) continue;
        const sup = arr => arr.some(k => supportIdx(y, k) !== undefined);
        if (!(sup(A) || hang) || (B.length && !(sup(B) || hang))) continue;
        const mk = arr => { const xs = arr.map(kx), zs = arr.map(kz), x0 = Math.min(...xs), z0 = Math.min(...zs); return { x: x0, z: z0, a: Math.max(...xs) - x0 + 1, b: Math.max(...zs) - z0 + 1, rc: arr }; };
        placed.splice(pi, 1, mk(A), ...(B.length ? [mk(B)] : []));
        covered.add(u);
        done = true;
      }
    }
    if (!done && hang) { placed.push({ x: ux, z: uz, a: 1, b: 1, rc: [u] }); covered.add(u); done = true; }
    if (!done) dropped.push({ y, x: ux, z: uz, color });
  }
  for (const c of placed) addPart(shape, c.a, c.b, c.x, y, c.z, color);
  return placed.length;
}
/** pack() within an 8×8 grid (offset ox, oz), so seams of consecutive layers never line up. */
function packTiled(cells, y, shape, color, opts, ox, oz, T = 8) {
  const tiles = new Map();
  for (const k of cells) { const t = Math.floor((kx(k) - ox) / T) + ',' + Math.floor((kz(k) - oz) / T); if (!tiles.has(t)) tiles.set(t, new Set()); tiles.get(t).add(k); }
  for (const g of tiles.values()) pack(g, y, shape, color, opts);
}
const byColor = m => { const g = new Map(); for (const [k, c] of m) { if (!g.has(c)) g.set(c, new Set()); g.get(c).add(k); } return g; };

/* ------------------------------------------------------------- slopes */
function outDirs(k) {
  const [px, pz] = rel(kx(k), kz(k));
  const r = Math.hypot(px, pz) || 1;
  return N4.map(d => ({ d, dot: (d[0] * px + d[1] * pz) / r })).filter(o => o.dot > 0.35).sort((a, b) => b.dot - a.dot).map(o => o.d);
}
const ROT = { '0,1': 0, '1,0': 90, '0,-1': 180, '-1,0': 270 };
/** 1×2 slope (or inverted slope) whose low / overhanging cell is `front`, descending along d. */
function slopePart(shape, front, d, y, color) {
  const fx = kx(front), fz = kz(front), bx = fx - d[0], bz = fz - d[1];
  const sx = d[0] !== 0 ? 2 : 1, sz = d[1] !== 0 ? 2 : 1;
  return addPart(shape, sx, sz, Math.min(fx, bx), y, Math.min(fz, bz), color, { rotation: ROT[d.join(',')] });
}

/* ================================================================ plan */
// podium (Tower Yard) footprint
const POD = { x0: -21, x1: 21, z0: -31, z1: 6 };
const podCells = new Set(), podEdge = new Set();
for (let x = POD.x0; x < POD.x1; x++) for (let z = POD.z0; z < POD.z1; z++) {
  podCells.add(key(x, z));
  if (x === POD.x0 || x === POD.x1 - 1 || z === POD.z0 || z === POD.z1 - 1) podEdge.add(key(x, z));
}
const pillar = k => { const x = kx(k), z = kz(k); const eX = x === POD.x0 || x === POD.x1 - 1, eZ = z === POD.z0 || z === POD.z1 - 1; return (eX && eZ) || (eZ && (x - POD.x0) % 6 === 0) || (eX && (z - POD.z0) % 6 === 0); };

function latticeCells(L) {
  const c = COURSES[L], out = new Map(), cols = columnCells(L), arc = arcFn(c.r);
  for (const k of bandOf(L)) {
    if (cols.has(k)) continue;
    const [px, pz] = rel(kx(k), kz(k)), th = Math.atan2(pz, px);
    // the gaps of the truss are filled with smoke-transparent bricks: the X pattern stays
    // crisp, the core and shafts show through, and every brick sits on a full course below
    out.set(k, !inLeg(px, pz, L) && latticeOpen(c, L, th, arc) ? 'gap' : 'skytree');
  }
  return out;
}

const plan = [];
for (let L = 0; L <= LAST_BODY; L++) {
  const c = COURSES[L], ins = insideOf(L), cols = columnCells(L), yL = yOfCourse(L);
  const bricks = new Map(), sheets = new Map();     // sheets: y -> Map(cell -> {color, shape, hang})
  const sheet = (y, k, color, shape = 'plate', hang = false) => { if (!sheets.has(y)) sheets.set(y, new Map()); sheets.get(y).set(k, { color, shape, hang }); };
  const p = { kind: c.kind, bricks, sheets };
  plan[L] = p;
  if (c.kind === 'podium' || c.kind === 'podiumroof') {
    for (const k of bandOf(L)) { const [px, pz] = rel(kx(k), kz(k)); if (inLeg(px, pz, L)) bricks.set(k, 'skytree'); }
    for (const [k, col] of cols) bricks.set(k, col);
    if (c.kind === 'podium') for (const k of podEdge) bricks.set(k, pillar(k) || L === 2 ? 'white' : 'glass-dark');
    continue;                                        // podium roof sheets are added after closure
  }
  if (c.kind === 'lattice') { for (const [k, col] of latticeCells(L)) bricks.set(k, col); for (const [k, col] of cols) bricks.set(k, col); continue; }
  // flare / deck / galleria / roof courses are shaped at build time from the real footprint
  // below them; for planning, approximate them by their target outline.
  for (const k of ins) bricks.set(k, 'skytree');
  p.dynamic = true;
}
/* ============================================================== closure */
// studs available on top of course L-1 (approximation used for planning only)
function studsBelow(L) {
  if (L === 0 || L === 5) return null;                          // the plaza / the podium roof: studs everywhere
  const s = new Set(plan[L - 1].bricks.keys());
  const sh = plan[L - 1].sheets.get(yOfCourse(L) - 1);
  if (sh) for (const [k, v] of sh) if (v.shape === 'plate') s.add(k);
  return s;
}
function runOK(S, color, below, c) {
  if (!below || below.has(c)) return true;
  const x = kx(c), z = kz(c);
  for (const [dx, dz] of N4) for (let i = 1; i < 8; i++) {
    const k = key(x + dx * i, z + dz * i);
    if (S.get(k) !== color) break;
    if (below.has(k)) return true;
  }
  return false;
}
let filled = 0, removed = 0;
const removedAt = {};
function tryFill(L, c, depth) {
  if (L < 1 || depth > 5) return false;
  const p = plan[L];
  if (p.kind !== 'lattice' || !bandOf(L).has(c) || p.bricks.has(c)) return false;
  p.bricks.set(c, 'skytree');
  if (runOK(p.bricks, 'skytree', studsBelow(L), c) || tryFill(L - 1, c, depth + 1)) { filled++; return true; }
  p.bricks.delete(c);
  return false;
}
for (let L = 1; L <= LAST_BODY; L++) {
  const p = plan[L];
  if (!['lattice', 'disk', 'podium', 'podiumroof'].includes(p.kind)) continue;
  for (let pass = 0; pass < 2; pass++) {
    const below = studsBelow(L);
    for (const c of [...p.bricks.keys()].sort((a, b) => a - b)) {
      const col = p.bricks.get(c);
      if (runOK(p.bricks, col, below, c)) continue;
      if (col === 'skytree' && tryFill(L - 1, c, 0)) { below.add(c); continue; }
      if (pass === 1) { p.bricks.delete(c); removed++; removedAt[L] = (removedAt[L] || 0) + 1; }
    }
  }
}

// podium roof: three plate layers over the whole Tower Yard. The lower layer rests on the
// walls and hangs from the middle layer; the top is tiled except where the tower stands.
{
  const L = 4, p = plan[L], yL = yOfCourse(L), above = plan[5].bricks;
  const roofCells = new Set([...podCells].filter(k => !p.bricks.has(k)));
  // drop small pockets fenced in by the legs / core / shafts — they could not be tied in
  const seen = new Set();
  for (const k0 of roofCells) {
    if (seen.has(k0)) continue;
    const comp = [k0]; seen.add(k0);
    for (let i = 0; i < comp.length; i++) for (const [dx, dz] of N4) { const n = key(kx(comp[i]) + dx, kz(comp[i]) + dz); if (roofCells.has(n) && !seen.has(n)) { seen.add(n); comp.push(n); } }
    if (!comp.some(k => podEdge.has(k))) for (const k of comp) roofCells.delete(k);
  }
  const sheet = (y, k, color, shape, hang) => { if (!p.sheets.has(y)) p.sheets.set(y, new Map()); p.sheets.get(y).set(k, { color, shape, hang }); };
  for (const k of roofCells) {
    sheet(yL, k, 'white', 'plate', !podEdge.has(k));
    sheet(yL + 1, k, 'white', 'plate', true);
    const under = above.has(k);
    sheet(yL + 2, k, under || podEdge.has(k) ? 'white' : 'roof', under ? 'plate' : 'tile', false);
  }
}

/* ================================================================ build */
const STEP_MARKS = [];                 // [yFrom, title, description]
const mark = (y, title, description) => STEP_MARKS.push([y, title, description]);

// ---- plaza: two staggered plate layers ------------------------------------------
const PX0 = -32, PX1 = 32, PZ0 = -36, PZ1 = 36;
mark(0, '土台のプレート', '濃いグレーの8×8プレートを8×9枚並べて、64×72スタッドの土台をつくります（1スタッド＝2m）。');
for (let x = PX0; x < PX1; x += 8) for (let z = PZ0; z < PZ1; z += 8) addPart('plate', 8, 8, x, 0, z, 'dark-gray');
mark(1, '広場の舗装', '石畳色のプレートを4スタッドずらして重ね、土台の継ぎ目をまたいで固定します。');
const cuts = (a0, a1) => { const out = [[a0, 4]]; for (let a = a0 + 4; a + 8 <= a1 - 4; a += 8) out.push([a, 8]); out.push([a1 - 4, 4]); return out; };
for (const [x, w] of cuts(PX0, PX1)) for (const [z, d] of cuts(PZ0, PZ1)) addPart('plate', w, d, x, 1, z, 'pavement');

// ---- ground details: 北十間川 (river), footbridge, path and trees ----------------
mark(2, '北十間川と並木', '正面に北十間川を青いタイルで敷き、両岸をグレーのタイルで縁取ります。橋と参道を渡し、広場には丸ブロックとコーンで並木を植えます。');
const RZ0 = 23, RZ1 = 31, BX0 = -3, BX1 = 3;
const riverCells = new Set(), bankCells = new Set(), walkCells = new Set(), bridge = new Set();
for (let x = PX0; x < PX1; x++) {
  const onBridge = x >= BX0 && x < BX1;
  for (let z = RZ0 - 2; z < RZ1 + 2; z++) {
    if (onBridge) bridge.add(key(x, z));
    else if (z === RZ0 - 1 || z === RZ1) bankCells.add(key(x, z));
    else if (z >= RZ0 && z < RZ1) riverCells.add(key(x, z));
  }
}
pack(riverCells, 2, 'tile', 'river');
pack(bankCells, 2, 'tile', 'dark-gray');
pack(bridge, 2, 'plate', 'light-gray');
pack(bridge, 3, 'tile', 'tan');
for (let x = -2; x < 2; x++) for (let z = POD.z1 + 1; z < RZ0 - 2; z++) walkCells.add(key(x, z));
pack(walkCells, 2, 'tile', 'tan');
const TREES = [];
for (const x of [-27, -21, -15, -9, 7, 13, 19, 25]) { TREES.push([x, 10]); TREES.push([x + 3, 16]); }
for (const z of [-30, -24, -18, -12, -6, 0]) { TREES.push([-29, z]); TREES.push([28, z + 2]); }
for (const [x, z] of TREES) {
  addPart('round-brick', 1, 1, x, 2, z, 'brown');
  addPart('round-brick', 2, 2, x, 5, z, 'dark-green');
  addPart('cone', 2, 2, x, 8, z, 'green');
}

// ---- tower courses, bottom-up ---------------------------------------------------
const ringOf = region => new Set([...region].filter(k => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dz]) => !region.has(key(kx(k) + dx, kz(k) + dz)))));

function placeSlopes(bricks, cand, yL, shape, ok) {
  // most constrained first: cells with the fewest usable directions
  const opts = k => outDirs(k).filter(dir => { const back = key(kx(k) - dir[0], kz(k) - dir[1]); return bricks.get(back) === 'skytree' && ok(k, back); });
  const list = cand.filter(k => bricks.has(k)).map(k => [k, opts(k).length]).filter(([, n]) => n > 0).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [k] of list) {
    if (!bricks.has(k)) continue;
    const dir = opts(k)[0];
    if (!dir) continue;
    slopePart(shape, k, dir, yL, 'skytree');
    bricks.delete(k); bricks.delete(key(kx(k) - dir[0], kz(k) - dir[1]));
  }
}

const diskCache = new Map();
const diskOf = R => { if (!diskCache.has(R)) diskCache.set(R, insideSet(circ(R))); return diskCache.get(R); };

function processCourse(L) {
  const d = plan[L], c = COURSES[L], yL = yOfCourse(L), cols = columnCells(L);
  let bricks = new Map(d.bricks);
  const sheets = new Map(d.sheets);
  const sheet = (y, k, color, shape = 'plate', hang = false) => { if (!sheets.has(y)) sheets.set(y, new Map()); sheets.get(y).set(k, { color, shape, hang }); };
  const sup = k => supportIdx(yL, k) !== undefined;
  if (d.dynamic) bricks = new Map(cols);
  if (d.kind === 'disk') for (const k of insideOf(L)) if (!cols.has(k)) bricks.set(k, 'skytree');
  if (d.kind === 'deckbase') {
    // two plate layers close the ring truss into a floor disk; the third steps out by one stud
    const inner = [...diskOf(c.rIn)].filter(k => !cols.has(k)), outer = [...diskOf(c.r(0))].filter(k => !cols.has(k));
    for (const k of inner) { sheet(yL, k, 'skytree', 'plate', true); sheet(yL + 1, k, 'skytree', 'plate', true); }
    for (const k of outer) sheet(yL + 2, k, 'skytree', 'plate');
  }
  if (d.kind === 'slab') {
    for (const k of diskOf(c.r(0))) if (!cols.has(k)) bricks.set(k, 'skytree');
    placeSlopes(bricks, [...bricks.keys()].filter(k => bricks.get(k) === 'skytree' && !sup(k)), yL, 'slope-inv', (k, back) => sup(back));
  }
  if (d.kind === 'flare') {
    // outer ring of inverted slopes (backs on the slab); inside it, the floor tiles
    const ring = [...diskOf(c.r(0))].filter(k => !diskOf(c.rIn).has(k));
    for (const k of ring) bricks.set(k, 'skytree');
    for (const k of diskOf(c.rIn)) if (!cols.has(k)) bricks.set(k, 'skytree');
    placeSlopes(bricks, ring, yL, 'slope-inv', (k, back) => sup(back));
    // leftover ring cells: a 1×2 brick reaching back onto the slab
    for (const k of ring) {
      if (!bricks.has(k)) continue;
      for (const [dx, dz] of N4) {
        const n = key(kx(k) + dx, kz(k) + dz);
        if (bricks.get(n) !== 'skytree' || ring.includes(n) || !sup(n)) continue;
        addPart('brick', dx ? 2 : 1, dz ? 2 : 1, Math.min(kx(k), kx(n)), yL, Math.min(kz(k), kz(n)), 'skytree');
        bricks.delete(k); bricks.delete(n);
        break;
      }
      if (bricks.has(k)) { bricks.delete(k); dropped.push({ y: yL, x: kx(k), z: kz(k), color: 'skytree' }); }
    }
    for (const k of [...bricks.keys()]) if (bricks.get(k) === 'skytree') { bricks.delete(k); sheet(yL, k, 'floor-tile', 'tile'); }
  }
  if (d.kind === 'deckwall' || d.kind === 'galwall') {
    const deck = d.kind === 'deckwall';
    const region = diskOf(c.r(0)), ring = ringOf(region);
    const floorsY = deck ? [yOfM(345), yOfM(350)] : [];
    const ceilY = deck ? yOfCourse(147) + 1 : yOfCourse(190) + 1;
    const interior = [...region].filter(k => !ring.has(k) && !cols.has(k));
    for (let y = yL; y < yL + 3; y++) {
      for (const k of ring) {
        let color;
        if (deck) color = floorsY.includes(y) || y >= ceilY ? 'skytree' : 'glass';
        else {
          const [px, pz] = rel(kx(k), kz(k));
          const turn = ((Math.atan2(pz, px) - Math.PI / 2) / (2 * Math.PI) + 2) % 1;  // the spiral starts at the front
          // the glass tube winds up 5 m per turn (445 m -> 450 m); its ramp shows as a white helix
          const f = ((mOfY(y) - 445 - 5 * turn) / 5 % 1 + 1) % 1;
          color = f < 0.17 || y >= ceilY || y === yOfCourse(185) ? 'skytree' : 'glass';
        }
        sheet(y, k, color);
      }
      // floors: white plates (ring colour, so edge plates rest on the wall) + floor tiles
      for (const fy of floorsY) {
        if (y === fy) for (const k of interior) sheet(y, k, 'skytree', 'plate', true);
        if (y === fy + 1) for (const k of interior) sheet(y, k, 'floor-tile', 'tile');
      }
      if (y === ceilY) for (const k of interior) sheet(y, k, 'skytree', 'plate', true);
      if (y === ceilY + 1) for (const k of interior) sheet(y, k, 'skytree', 'plate');
    }
  }
  if (d.kind === 'roof') {
    for (const k of diskOf(c.r(0))) if (!cols.has(k)) bricks.set(k, 'skytree');
    const next = c.next ? diskOf(c.next) : insideOf(L + 1);
    placeSlopes(bricks, [...bricks.keys()].filter(k => !next.has(k) && bricks.get(k) === 'skytree'), yL, 'slope', (k, back) => sup(k) || sup(back));
  }
  for (const [color, cells] of byColor(bricks)) pack(cells, yL, 'brick', color);
  for (let y = yL; y < yL + 3; y++) {
    const sh = sheets.get(y);
    if (!sh) continue;
    const groups = new Map(), hangs = new Set();
    for (const [k, v] of sh) { const g = `${v.shape}|${v.color}`; if (!groups.has(g)) groups.set(g, new Set()); groups.get(g).add(k); if (v.hang) hangs.add(g); }
    for (const [g, cells] of groups) {
      const [shape, color] = g.split('|');
      // plate sheets are laid in 8×8 bays that shift by 4 studs every layer (a running bond)
      if (shape === 'plate') packTiled(cells, y, shape, color, { hang: hangs.has(g) }, TC.x + (y % 2) * 4, TC.z + (y % 2) * 4);
      else pack(cells, y, shape, color, { hang: hangs.has(g) });
    }
  }
}
for (let L = 0; L <= LAST_BODY; L++) processCourse(L);

/* ---------------------------------------------------------- gain tower */
// ゲイン塔: Ø6–8 m steel lattice mast from 497 m, antenna bands, then the spire to 634 m.
const G = (dx, dz) => key(TC.x + dx, TC.z + dz);
const G_RING = [[-1, -2], [0, -2], [1, -1], [1, 0], [0, 1], [-1, 1], [-2, 0], [-2, -1]];
const G_INNER = [[-1, -1], [0, -1], [-1, 0], [0, 0]];
const G_CORNER = [[-2, -2], [1, -2], [-2, 1], [1, 1]];
const gCells = list => new Set(list.map(([x, z]) => G(x, z)));
let gy = yOfCourse(LAST_BODY + 1);
mark(gy, 'ゲイン塔の基部（497m〜）', '塔体の頂部をふさいだら、4×4の角を落とした断面でゲイン塔の基部を積みます。');
for (let i = 0; i < 4; i++, gy += 3) pack(gCells([...G_RING, ...G_INNER]), gy, 'brick', 'skytree');
const G_BANDS = [[522, 530], [546, 551], [574, 580]];
const inBand = y => G_BANDS.some(([a, b]) => mOfY(y) >= a && mOfY(y) < b);
mark(gy, 'ゲイン塔のトラス（505〜605m）', '内側の2×2を芯にして、外周はリングと1×1の柱を交互に積み、すき間の抜けたトラスにします。ところどころの太い段はアンテナを収めた部分です。');
for (let gi = 0; mOfY(gy) < 604; gi++, gy += 3) {
  if (inBand(gy)) { pack(gCells([...G_RING, ...G_INNER, ...G_CORNER]), gy, 'brick', 'antenna'); continue; }
  pack(gCells(G_INNER), gy, 'brick', 'skytree');
  if (gi % 2 === 0) for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7]]) pack(gCells([G_RING[a], G_RING[b]]), gy, 'brick', 'skytree');
  else for (const i of (gi >> 1) % 2 ? [0, 2, 4, 6] : [1, 3, 5, 7]) pack(gCells([G_RING[i]]), gy, 'brick', 'skytree');
}
pack(gCells([...G_RING, ...G_INNER]), gy, 'brick', 'skytree'); gy += 3;
mark(gy, '頂部の避雷針と航空障害灯（605〜634m）', '丸ブロックで細くしながら634mの頂部まで伸ばします。赤い丸プレートは航空障害灯です。');
while (gy < 780) { addPart('round-brick', 2, 2, TC.x - 1, gy, TC.z - 1, 'skytree'); gy += 3; }
addPart('round-plate', 2, 2, TC.x - 1, gy, TC.z - 1, 'trans-red'); gy += 1;
while (gy < 790) { addPart('round-brick', 1, 1, TC.x - 1, gy, TC.z - 1, 'skytree'); gy += 3; }
addPart('round-plate', 1, 1, TC.x - 1, gy, TC.z - 1, 'trans-red'); gy += 1;
addPart('cone', 1, 1, TC.x - 1, gy, TC.z - 1, 'light-gray'); gy += 3;
const topY = gy;

/* ------------------------------------------------------------ steps */
mark(yOfCourse(0), 'タワーヤード 1階', 'タワーの足もとを囲む低層棟。濃いガラスの壁と白い柱で外周をつくり、内側には3本の脚・心柱（コンクリート色）・エレベーターシャフト（鉄骨色）を立ち上げます。');
mark(yOfCourse(2), 'タワーヤード 2〜3階', '白い帯とガラスの帯を1段ずつ積み、脚・心柱・シャフトも同じ高さまで伸ばします。');
mark(yOfCourse(4), 'タワーヤードの屋上', '屋上を白いプレート2層で張ります。下の層は壁の上に載せ、上の層で継ぎ目をまたいで一枚につなげます。');
const LAT_DESC = '三角形から円へ少しずつ形を変えながら、X形のトラスと水平リングを交互に積み上げます。すき間から心柱とシャフトが見えます。';
const hts = (a, b) => `${Math.round(a * M_COURSE)}〜${Math.round(b * M_COURSE)}m`;
for (let L = 5; L < 138; L += 14) mark(L === 5 ? yOfCourse(5) - 1 : yOfCourse(L), `塔体 ${hts(L, Math.min(L + 14, 138))}`,
  L === 5 ? '屋上をタイルで仕上げ、塔が立つところだけプレートにします。そこから三角形の断面で塔体を立ち上げます。三隅の脚は太く、面はX形のトラスと水平リングで編みます。' : LAT_DESC);
for (const [L, t, dsc] of [
  [139, '天望デッキの床', 'トラスの輪を白いプレート2層でふさぎ、デッキの床をつくります。下の層は輪の上に載せ、上の層で継ぎ目をまたいで一枚につなげます。'],
  [139.67, '天望デッキの床版と張り出し', 'ブロックの床版を置き、外周に逆スロープを並べて2段で張り出します。フロア340の床はタイルで仕上げます。'],
  [142, '天望デッキ フロア345', '外周はガラスのプレートを積み、床の高さに白い帯を入れます。内側に床（白いプレートとタイル）を張ります。'],
  [145, '天望デッキ フロア350と天井', '最上階のフロア350と天井。天井は2層のプレートで張ります。'],
  [148, '天望デッキの屋根', 'スロープで外周をすぼめながら、屋根を2段で閉じます。'],
  [150, `塔体 ${hts(150, 166)}`, '円形断面の塔体。心柱は375mで終わり、その上はシャトルエレベーターのシャフトだけが続きます。'],
  [166, `塔体 ${hts(166, 183)}`, LAT_DESC],
  [183, '天望回廊の床', 'デッキと同じく、塔体の輪をプレート2層でふさいで床にします。'],
  [183.67, '天望回廊', '外へ張り出し、445mから450mへらせん状に上るガラスの回廊をプレートで描きます。'],
  [191, '天望回廊の屋根と塔体頂部', 'スロープで屋根を閉じ、アンテナ部を細くしぼりながら積みます。'],
  [199, `塔体頂部 ${hts(199, 207)}`, '495mの頂部を円盤状のブロックでふさぎ、ゲイン塔の土台にします。']
]) mark(Math.round(yOfCourse(L)), t, dsc);
STEP_MARKS.sort((a, b) => a[0] - b[0]);
const stepOf = y => { let s = 0; for (let i = 0; i < STEP_MARKS.length; i++) if (y >= STEP_MARKS[i][0]) s = i; return s; };

/* ------------------------------------------------------------ output */
const COLORS = {
  'skytree':    { name: 'Skytree White', hex: '#e6edf3' },
  'concrete':   { name: 'Concrete Gray', hex: '#a3a7a6' },
  'steel':      { name: 'Steel Gray', hex: '#5d646c' },
  'antenna':    { name: 'Antenna Gray', hex: '#c3c9cf' },
  'glass':      { name: 'Deck Glass', hex: '#6d8fa8', opacity: 0.62 },
  'gap':        { name: 'Trans Smoke', hex: '#39434f', opacity: 0.34 },
  'glass-dark': { name: 'Dark Glass', hex: '#3b5366', opacity: 0.88 },
  'floor-tile': { name: 'Floor Beige', hex: '#c9c2b2' },
  'roof':       { name: 'Roof Gray', hex: '#b9bec2' },
  'pavement':   { name: 'Pavement', hex: '#b7b2a6' },
  'river':      { name: 'River Blue', hex: '#3f6f93' },
  ...Object.fromEntries(['white', 'light-gray', 'dark-gray', 'tan', 'brown', 'green', 'dark-green', 'trans-red'].map(k => [k, core.STANDARD_COLORS[k]]))
};
parts.forEach(p => { p.step = stepOf(p.y) + 1; });
// bottom-up order: the build-order check places parts in array order within a step
const order = parts.map((p, i) => i).sort((a, b) => parts[a].y - parts[b].y || a - b);
const blocks = order.map((i, n) => {
  const p = parts[i];
  return { id: `block_${String(n + 1).padStart(5, '0')}`, shape: p.shape, width: p.width, depth: p.depth, height: p.height, x: p.x, y: p.y, z: p.z, rotation: p.rotation, color: p.color, step: p.step };
});
const usedSteps = [...new Set(blocks.map(b => b.step))].sort((a, b) => a - b);
const remap = new Map(usedSteps.map((s, i) => [s, i + 1]));
blocks.forEach(b => { b.step = remap.get(b.step); });
const steps = usedSteps.map((s, i) => ({ step: i + 1, title: STEP_MARKS[s - 1][1], description: STEP_MARKS[s - 1][2] }));
const usedColors = new Set(blocks.map(b => b.color));
const raw = {
  format: 'blockmade.model', version: 2,
  name: '東京スカイツリー', nameEn: 'Tokyo Skytree',
  description: `高さ634mの自立式電波塔を1スタッド＝2mで再現。足もとの一辺68mの正三角形が高さ320mで円に変わる断面、X形トラスと水平リングの外殻、すき間から見える心柱とエレベーターシャフト、350mの天望デッキ、らせん状のガラス回廊をもつ450mの天望回廊、頂部のゲイン塔まで。足もとにはタワーヤードと北十間川。`,
  author: 'Claude', prompt: '超リアルな東京スカイツリー', createdAt: '2026-09-24',
  colors: Object.fromEntries(Object.entries(COLORS).filter(([k]) => usedColors.has(k))),
  steps, blocks
};
// prune the few parts that ended up in fenced-in pockets (e.g. 1-stud gaps between the core and a shaft)
let pruned = 0;
for (;;) {
  const chk = core.validateModel(core.normalizeModel(raw));
  const bad = new Set([...chk.supported.floating, ...chk.connected.groups.slice(1).flat()]);
  if (!bad.size) break;
  pruned += bad.size;
  raw.blocks = raw.blocks.filter(b => !bad.has(b.id));
}
raw.blocks.forEach((b, n) => { b.id = `block_${String(n + 1).padStart(5, '0')}`; });
// a few tie plates only connect once the next step's parts are on: move them to that step
for (let pass = 0; pass < 6; pass++) {
  const chk = core.validateModel(core.normalizeModel(raw));
  const late = new Set(chk.order.issues.filter(i => i.msg.includes('宙に浮')).map(i => i.id));
  if (!late.size) break;
  const maxStep = Math.max(...raw.blocks.map(b => b.step));
  raw.blocks.forEach(b => { if (late.has(b.id)) b.step = Math.min(maxStep, b.step + 1); });
}
const m = core.normalizeModel(raw);
writeFileSync(join(root, 'models/tokyo-skytree.json'), core.modelToJSON(m));
console.log(`parts ${raw.blocks.length} (pruned ${pruned}), steps ${steps.length}, top y ${topY} (${((topY - Y0) * M_PLATE).toFixed(1)} m), closure filled ${filled} removed ${removed}, dropped cells ${dropped.length}`);
const dropByY = {}; for (const d of dropped) dropByY[d.y] = (dropByY[d.y] || 0) + 1;
if (dropped.length) console.log('dropped by y:', JSON.stringify(dropByY));
if (removed) console.log('closure removed by course:', JSON.stringify(removedAt));
if (m.warnings.length) console.log('warnings:', m.warnings.slice(0, 10), m.warnings.length);

if (process.env.DEBUG_Y) {
  for (const yy of process.env.DEBUG_Y.split(',').map(Number)) {
    const dr = new Set(dropped.filter(d => d.y === yy).map(d => key(d.x, d.z)));
    console.log(`--- y=${yy} (#=occupied  o=dropped  .=studs below)`);
    for (let z = TC.z - 22; z < TC.z + 14; z++) {
      let line = '';
      for (let x = TC.x - 22; x < TC.x + 22; x++) {
        const k = key(x, z);
        line += dr.has(k) ? 'o' : occ.get(yy)?.has(k) ? '#' : supportIdx(yy, k) !== undefined ? '.' : ' ';
      }
      if (line.trim()) console.log(line);
    }
  }
}
