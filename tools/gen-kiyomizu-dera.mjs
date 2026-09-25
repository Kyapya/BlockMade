// Generates models/kiyomizu-dera.json — Otowa-san Kiyomizu-dera, Kyoto, in autumn.
//   node tools/gen-kiyomizu-dera.mjs          (then: node tools/validate.mjs && node tools/build.mjs)
//   DEBUG_Y=26,38 node tools/gen-kiyomizu-dera.mjs   prints plan-view maps of those plate levels
//   DEBUG_STATS=<group> / DEBUG_MAP=1 / DEBUG_PRUNE=2   part counts per level, terrain parts per 8 x 8, what gets pruned
//
// Scale: 1 stud = 1.5 m, 1 plate = 0.6 m (one brick course = 1.8 m), the same proportion as a
// real LEGO brick. The main hall is 25 x 21 studs (about 36 x 30 m); its stage stands on a lattice
// of keyaki pillars about 21 plates (13 m) above the slope below.
// Model frame: +Z = south (the valley, Kinunkei), +X = east (Otowa-yama). The approach climbs from
// the west: Kiyomizu-zaka -> Nio-mon -> Sai-mon -> three-storied pagoda -> Todoroki-mon -> main hall.
//
// Pipeline
//   1. terrain  — a height field of terraces (street, Nio-mon terrace, the temple plateau), the
//                 slope below the cliff, the valley with its path and stream, the hills around.
//   2. halls    — each hall is a body (pillars of round bricks, walls between them, a bracket ring
//                 and an eave slab) and a roof. The main hall and Oku-no-in stand on kakezukuri:
//                 a grid of round-brick pillars from the slope, tied by nuki beams every 7 plates.
//   3. roofs    — hipped, irimoya and gable roofs are laid course by course with real slope parts
//                 (4-, 3- and 2-deep, so the pitch steepens toward the ridge like a temple roof);
//                 where no slope fits (hips, junctions) the course is stepped bricks.
//   4. trees    — maples in autumn colours, cedars on the mountain.
//   5. pack     — each plate level is covered with real parts, bottom-up (as in gen-tokyo-station.mjs):
//                 bricks where three levels match, tiles on exposed tops, plates elsewhere.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = require(join(root, 'js/model-core.js'));
const { PARTS } = core;

/* ------------------------------------------------------------------ grid */
const X_OFF = -84, Z_OFF = -48;          // grid index 0 -> stud -84 / -48
const NX = 136, NZ = 96, NY = 82;
const YS = 0;                            // design level 0 is the base layer
const I = x => x - X_OFF, K = z => z - Z_OFF;
const X0 = X_OFF, X1 = X_OFF + NX, Z0 = Z_OFF, Z1 = Z_OFF + NZ;

/* ------------------------------------------------------------------ voxels */
const MATS = [null];
const MAT = {};
const mat = k => { if (!(k in MAT)) { MAT[k] = MATS.length; MATS.push(k); } return MAT[k]; };
mat('reserved');
const vox = new Uint8Array(NX * NZ * NY);
const flags = new Uint8Array(NX * NZ * NY);       // 1 = hang: a plate here may hang from the layer above
const grp = new Uint8Array(NX * NZ * NY);         // build group (see GROUPS) of each voxel
const slopeFront = new Uint8Array(NX * NZ * NY);  // voxel of a slope part's sloped rows (nothing may sit on it)
const FL_HANG = 1;
let GROUP = 0;
const idx = (i, k, j) => (j * NZ + k) * NX + i;
const inGrid = (i, k, j) => i >= 0 && i < NX && k >= 0 && k < NZ && j >= 0 && j < NY;
const gv = (i, k, j) => inGrid(i, k, j) ? vox[idx(i, k, j)] : 0;
const sv = (i, k, j, m, f = 0) => { if (inGrid(i, k, j)) { const d = idx(i, k, j); vox[d] = typeof m === 'string' ? mat(m) : m; flags[d] = f; grp[d] = GROUP; } };
// stud-coordinate helpers (design levels: y = 0 is the upper base layer)
const get = (x, z, y) => gv(I(x), K(z), y + YS);
const put = (x, z, y, m, f = 0) => sv(I(x), K(z), y + YS, m, f);
const putE = (x, z, y, m, f = 0) => { if (inGrid(I(x), K(z), y + YS) && !get(x, z, y)) put(x, z, y, m, f); };
const clr = (x, z, y) => { const j = y + YS; if (inGrid(I(x), K(z), j)) { const d = idx(I(x), K(z), j); vox[d] = 0; flags[d] = 0; slopeFront[d] = 0; } };
const column = (x, z, y0, y1, m, f = 0) => { for (let y = y0; y < y1; y++) put(x, z, y, m, f); };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Special parts: placed as they are (slopes, round bricks, cones). Their voxels are 'reserved'
   so the packer leaves them alone and the neighbours count them as filled. */
const SPECIALS = [];
const reserveCell = (x, z, y0, y1) => { for (let y = y0; y < y1; y++) put(x, z, y, 'reserved'); };
function special(shape, x, z, y, color, { sx = 1, sz = 1, rot = null, h = null, reserve = true } = {}) {
  const hh = h ?? PARTS[shape].heights[0];
  if (reserve) for (let a = 0; a < sx; a++) for (let b = 0; b < sz; b++) reserveCell(x + a, z + b, y, y + hh);
  SPECIALS.push({ shape, sx, sz, i: I(x), k: K(z), j: y + YS, color, rot, h: hh, g: GROUP });
}
/** A column of round bricks (and round plates for the remainder) filling [y0, y1). */
function pillar(x, z, y0, y1, color, { base = null } = {}) {
  let y = y0;
  if (base && y < y1) { special('round-plate', x, z, y, base); y++; }
  while (y1 - y >= 3) { special('round-brick', x, z, y, color); y += 3; }
  while (y < y1) { special('round-plate', x, z, y, color); y++; }
}

/* deterministic noise and random numbers */
function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, s) {
  const fx = x / s, fz = z / s, x0 = Math.floor(fx), z0 = Math.floor(fz);
  const sm = t => t * t * (3 - 2 * t), tx = sm(fx - x0), tz = sm(fz - z0);
  const a = hash2(x0, z0), b = hash2(x0 + 1, z0), c = hash2(x0, z0 + 1), d = hash2(x0 + 1, z0 + 1);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}
let seed = 20260924;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/* ================================================================== 1. terrain */
// Levels are design plate levels of the TOP voxel of a ground column.
const P = 22;                            // the temple plateau
const VAL = 4;                           // the valley path below the stage
const OT = 7;                            // the terrace of the Otowa waterfall
const q3 = t => 3 * Math.round((t - 1) / 3) + 1;   // surfaces sit on whole brick courses
const inBox = (x, z, b) => x >= b[0] && x < b[1] && z >= b[2] && z < b[3];
const STAIRS_NIO = [-76, -68, -32, -24];     // Kiyomizu-zaka -> Nio-mon terrace (6 -> 14)
const STAIRS_SAI = [-60, -52, -21, -15];     // Nio-mon terrace -> Sai-mon (14 -> 22)
const OTOWA = [20, 37, -5, 8];               // the terrace of the Otowa waterfall
const OTOWA_WALL = [20, 37, -9, -5];         // the stone wall the three streams fall from
const POOL = [24, 33, -5, -2];
const STREAM_Z = [13, 15];
const PATH_Z = [8, 12];

/** Plateau edge: the plateau (and the terraces) cover z < cliffZ(x). */
function cliffZ(x) {
  if (x < -52) return -12;
  if (x < -8) return -8 + (vnoise(x, 3, 9) < 0.35 ? 1 : 0);
  return -13;
}
function terraceLevel(x, z) {
  if (x < -76) return 7;                                                   // the street
  if (x < -68) return inBox(x, z, STAIRS_NIO) ? 7 + clamp(x + 75, 0, 6) : 7;
  if (x < -52) return inBox(x, z, STAIRS_SAI) ? 13 + Math.round((x + 61) * 9 / 8) : 13;   // Nio-mon terrace
  if (x >= 46) return Math.min(34, q3(P + (x - 46) * 0.8));                // Otowa-yama rises east
  return P;
}
const pathLevel = x => VAL + clamp(Math.round((x - 12) / 2), 0, OT - VAL);   // climbs east to Otowa
function hills(x, z) {
  const bump = (cx, cz, r, h) => { const d = Math.hypot(x - cx, z - cz); return d < r ? 3 + h * (1 - (d / r) ** 2) : 0; };
  let t = Math.max(bump(42, 40, 20, 14), bump(-50, 46, 22, 12));
  if (z > 17) t = Math.max(t, Math.min(16, 3 + (z - 17) * (0.75 + vnoise(x, 9, 11) * 0.4)));   // the far side of Kinunkei
  if (x > 40) t = Math.max(t, Math.min(25, 3 + (x - 40) * 1.2 - Math.max(0, z - 30) * 0.2));
  if (Math.hypot(x - 42, z - 38) < 6.5) t = 16;                             // the pad of Koyasu-no-to
  return t ? q3(t) : 0;
}
function rawT(x, z) {
  const cl = cliffZ(x), top = terraceLevel(x, z);
  if (z < cl) return top;
  if (inBox(x, z, OTOWA_WALL)) return 16;
  if (inBox(x, z, POOL)) return OT - 2;
  if (inBox(x, z, OTOWA)) return OT;
  const d = z - cl + 1;
  const rate = 1.0 + vnoise(x, z, 7) * 0.45;
  let t = q3(top - d * rate);
  const v = x < 22 && z >= STREAM_Z[0] && z < STREAM_Z[1] ? 1 : pathLevel(Math.min(x, 36));
  t = Math.max(t, v, hills(x, z));
  if (x < 22 && z >= STREAM_Z[0] && z < STREAM_Z[1] && t <= pathLevel(x)) t = 1;
  return t;
}
const TER = new Int16Array(NX * NZ);
for (let x = X0; x < X1; x++) for (let z = Z0; z < Z1; z++) TER[I(x) * NZ + K(z)] = rawT(x, z);
const T = (x, z) => (x < X0 || x >= X1 || z < Z0 || z >= Z1) ? 0 : TER[I(x) * NZ + K(z)];

// footprints of everything built: no trees there, gravel around the halls
const BUILT = [];
const built = (x0, x1, z0, z1, pad = 0) => BUILT.push([x0 - pad, x1 + pad, z0 - pad, z1 + pad]);
const isBuilt = (x, z, m = 0) => BUILT.some(b => x >= b[0] - m && x < b[1] + m && z >= b[2] - m && z < b[3] + m);

const APPROACH = [-52, -13, -21, -15];        // the stone-paved approach from Sai-mon to Todoroki-mon
function surfaceMat(x, z) {
  const t = T(x, z), cl = cliffZ(x);
  if (x < 22 && z >= STREAM_Z[0] && z < STREAM_Z[1] && t === 1) return 'water';
  if (inBox(x, z, STAIRS_NIO) || inBox(x, z, STAIRS_SAI)) return 'step';
  if (x < -76) return 'street';
  if (inBox(x, z, OTOWA) || inBox(x, z, POOL)) return 'paving';
  if (inBox(x, z, OTOWA_WALL)) return 'moss';
  if (z >= PATH_Z[0] && z < PATH_Z[1] && x < 37 && t === pathLevel(Math.min(x, 36))) return 'path';
  if (z < cl) {
    if (x < -68) return 'street';
    if (x < -52) return (z >= -35 && z < -21) || (z >= -23 && z < -13 && x >= -62) ? 'paving' : 'moss';
    if (inBox(x, z, APPROACH)) return 'paving';
    if (x >= 46 || z < -40) return vnoise(x, z, 9) < 0.5 ? 'moss' : 'undergrowth';
    return z >= cl - 1 ? 'moss' : 'gravel';
  }
  if (z > 17 && t >= 16) return vnoise(x, z, 9) < 0.5 ? 'moss' : 'undergrowth';          // the wooded ridge top
  return vnoise(x, z, 10) < 0.28 ? 'leaf-litter' : 'undergrowth';
}
function sideMat(x, z) {
  if (z < cliffZ(x) || inBox(x, z, OTOWA) || inBox(x, z, OTOWA_WALL) || inBox(x, z, POOL)) return 'ishigaki';
  return 'earth';
}
function writeTerrain() {
  GROUP = 0;
  // the base: 8 x 8 plates, each under one of the ribs below
  for (let x = X0; x < X1; x += 8) for (let z = Z0; z < Z1; z += 8) special('plate', x, z, 0, 'base', { sx: 8, sz: 8 });
  for (let x = X0; x < X1; x++) for (let z = Z0; z < Z1; z++) {
    const t = T(x, z), sm = surfaceMat(x, z), sd = sideMat(x, z);
    let low = t;                          // lowest neighbour top
    for (const [dx, dz] of N4) low = Math.min(low, T(x + dx, z + dz));
    for (let y = 1; y <= t; y++) put(x, z, y, y === t ? sm : y > low ? sd : 'soil');
  }
  // hollow inside, like a real brick landscape: two-stud walls run north-south every 8 studs (one
  // over every base plate) and the ground between them is hollow up to the lowest surface nearby,
  // which spans the 6-stud gap as a lid; a wall runs round the edge
  for (let px = X0 + 2; px < X1 - 2; px += 8) for (let pz = Z0 + 2; pz < Z1 - 2; pz += 8) {
    let thr = Infinity;
    for (let x = px - 1; x < px + 7; x++) for (let z = pz - 1; z < pz + 9; z++) thr = Math.min(thr, T(x, z));
    for (let x = px; x < Math.min(px + 6, X1 - 2); x++) for (let z = pz; z < Math.min(pz + 8, Z1 - 2); z++) for (let y = 1; y < thr; y++) clr(x, z, y);
  }
  // the pool below the waterfall: water one plate below the terrace
  for (let x = POOL[0]; x < POOL[1]; x++) for (let z = POOL[2]; z < POOL[3]; z++) put(x, z, OT - 1, 'water');
  for (let x = POOL[0] - 1; x <= POOL[1]; x++) put(x, POOL[3], OT + 1, 'ishigaki');
}
writeTerrain();

/* ================================================================== 2. building helpers */
// Every hall below is a stack of: a stone plinth, a body (pillars on the ring, walls between them,
// a solid core inside), a bracket ring (hanging brackets one stud outside the walls), an eave slab
// and a roof.
const DIRS = { s: [0, 1, 0], n: [0, -1, 180], e: [1, 0, 90], w: [-1, 0, 270] };   // outward (dx, dz), slope rotation
const SLOPE_W = d => PARTS.slope.sizes.filter(([, dd]) => dd === d).map(([w]) => w).sort((a, b) => b - a);

/**
 * Roof over the rectangle [x0, x1) x [z0, z1) with its eave slab at yb - 1 and its first course at yb.
 *   ns / ew   slope depths per course for the south+north / east+west faces (same count). A course of
 *             depth d advances d - 1 studs inward and rises one brick; 4 -> 3 -> 2 makes the concave
 *             pitch of a temple roof.
 *   cap       { dir: n } — that face is hipped for n courses only, then a vertical gable (irimoya);
 *             n = 0 is a plain gable end.
 *   open      { dir: true } — no eave on that side (the roof runs into another roof or the hill).
 *   order     face priority where two faces meet (the long faces first).
 */
function roof(o) {
  const { x0, x1, z0, z1, yb, mat: rm, core: cm = rm, ridge: ridgeMat = null, gable: gm = rm } = o;
  const prof = { s: o.ns, n: o.ns, e: o.ew, w: o.ew };
  const nC = o.ns.length;
  const F = {}, Bk = {};
  for (const d in prof) { F[d] = []; Bk[d] = []; let f = 0; for (const dd of prof[d]) { F[d].push(f); Bk[d].push(f + dd - 1); f += dd - 1; } }
  const insetOf = (d, x, z) => d === 's' ? z1 - 1 - z : d === 'n' ? z - z0 : d === 'e' ? x1 - 1 - x : x - x0;
  const capU = {};
  for (const d of 'snew') {
    if (o.open?.[d]) capU[d] = -1;
    else if (o.cap?.[d] !== undefined) capU[d] = o.cap[d] === 0 ? 0 : Bk[d][o.cap[d] - 1];
    else capU[d] = Infinity;
  }
  const eff = (d, x, z) => { const u = insetOf(d, x, z); return u < capU[d] ? u : Infinity; };
  const cov = (d, u) => { if (u === Infinity) return Infinity; let k = -1; for (let i = 0; i < nC; i++) if (F[d][i] <= u) k = i; return k; };
  const order = o.order || 'snew';
  const inFoot = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1 && (!o.mask || o.mask(x, z));
  const Kof = (x, z) => { let k = Infinity; for (const d of 'snew') k = Math.min(k, cov(d, eff(d, x, z))); return Math.min(k, nC - 1); };
  const top = (x, z) => yb + 3 * (Kof(x, z) + 1);
  // eave slab: rafters underneath, the rafter ends on the outer ring
  const eaveMat = o.eave || 'eave', edgeMat = o.eaveEdge || eaveMat;
  // (the rafter ends hang as a line under the slab edge, so the slab itself is one colour)
  if (o.slab !== false) for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    if (!inFoot(x, z)) continue;
    const ring = [...'snew'].some(d => capU[d] !== -1 && insetOf(d, x, z) === 0);
    putE(x, z, yb - 1, eaveMat);
    if (ring && edgeMat !== eaveMat && get(x, z, yb - 1) === MAT[eaveMat]) putE(x, z, yb - 2, edgeMat, FL_HANG);
  }
  // slopes, course by course
  const slopeOK = (x, z, d, k, dd) => {
    const [ox, oz] = DIRS[d], u0 = eff(d, x, z);
    for (let t = 0; t < dd; t++) {
      const cx = x - ox * t, cz = z - oz * t;
      if (!inFoot(cx, cz) || insetOf(d, cx, cz) !== u0 + t) return false;
      const kk = Kof(cx, cz);
      if (t < dd - 1 ? kk !== k : kk < k) return false;
      for (let y = yb + 3 * k; y < yb + 3 * k + 3; y++) if (get(cx, cz, y)) return false;
    }
    return true;
  };
  const placeSlope = (x, z, d, k, dd, w) => {
    const [ox, oz, rot] = DIRS[d];
    const ax = oz !== 0 ? 1 : 0, az = oz !== 0 ? 0 : 1;          // along the eave
    const y = yb + 3 * k;
    for (let a = 0; a < w; a++) for (let t = 0; t < dd; t++) {
      const cx = x + ax * a - ox * t, cz = z + az * a - oz * t;
      for (let yy = y; yy < y + 3; yy++) { put(cx, cz, yy, 'reserved'); if (t < dd - 1) slopeFront[idx(I(cx), K(cz), yy + YS)] = 1; }
    }
    const xs = [x, x + ax * (w - 1), x - ox * (dd - 1)], zs = [z, z + az * (w - 1), z - oz * (dd - 1)];
    const sx = ox !== 0 ? dd : w, sz = ox !== 0 ? w : dd;
    SPECIALS.push({ shape: 'slope', sx, sz, i: I(Math.min(...xs)), k: K(Math.min(...zs)), j: y + YS, color: o.slopeMat || rm, rot, h: 3, g: GROUP });
    slopeCount++;
  };
  for (let k = 0; k < nC; k++) for (const d of order) {
    if (capU[d] === -1 || (capU[d] !== Infinity && F[d][k] >= capU[d])) continue;
    const dd = prof[d][k], [ox, oz] = DIRS[d];
    const ax = oz !== 0 ? 1 : 0, az = oz !== 0 ? 0 : 1;
    // front cells of this course on this face, walked along the eave
    const fronts = [];
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) if (inFoot(x, z) && eff(d, x, z) === F[d][k]) fronts.push([x, z]);
    fronts.sort((p, q) => (p[0] * ax + p[1] * az) - (q[0] * ax + q[1] * az));
    const used = new Set();
    for (const [x, z] of fronts) {
      if (used.has(x + ',' + z)) continue;
      let placed = false;
      for (const w of SLOPE_W(dd)) {
        let ok = true;
        for (let a = 0; a < w && ok; a++) { const cx = x + ax * a, cz = z + az * a; ok = !used.has(cx + ',' + cz) && eff(d, cx, cz) === F[d][k] && slopeOK(cx, cz, d, k, dd); }
        if (!ok) continue;
        placeSlope(x, z, d, k, dd, w);
        for (let a = 0; a < w; a++) used.add((x + ax * a) + ',' + (z + az * a));
        placed = true; break;
      }
      // a leftover single under a 4-deep course: a 1 x 3 slope, the fourth row stays a step
      if (!placed && dd === 4 && slopeOK(x, z, d, k, 3)) { placeSlope(x, z, d, k, 3, 1); used.add(x + ',' + z); }
    }
  }
  // the rest: core up to the course below the top, the top course as stepped roofing
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    if (!inFoot(x, z)) continue;
    const tp = top(x, z);
    for (let y = yb; y < tp; y++) putE(x, z, y, y >= tp - 3 ? (o.stepMat || rm) : cm);
  }
  // gable faces (irimoya and gable ends)
  for (const d of 'snew') {
    if (o.cap?.[d] === undefined) continue;
    const yg = yb + 3 * o.cap[d];
    let best = null;
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      if (!inFoot(x, z) || insetOf(d, x, z) !== capU[d]) continue;
      const tp = top(x, z);
      for (let y = yg; y < tp; y++) { const m = get(x, z, y); if (m === MAT[rm] || m === MAT[cm] || m === MAT[o.stepMat]) put(x, z, y, gm); }
      if (!best || tp > best[2]) best = [x, z, tp];
    }
    // gegyo (the hanging ornament) under the apex of the gable
    if (best && o.gegyo && best[2] - 2 >= yg && get(best[0], best[1], best[2] - 2) === MAT[gm]) put(best[0], best[1], best[2] - 2, o.gegyo);
  }
  // ridge: two plates on the flat top, raised at both ends (oni-ita)
  if (ridgeMat) {
    const cells = [];
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      if (!inFoot(x, z)) continue;
      if ([...'snew'].every(d => { const u = eff(d, x, z); return u === Infinity || u >= Bk[d][nC - 1]; })) cells.push([x, z]);
    }
    if (cells.length) {
      const yt = yb + 3 * nC;
      const xs = cells.map(c => c[0]), zs = cells.map(c => c[1]);
      const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
      const lo = alongX ? Math.min(...xs) : Math.min(...zs), hi = alongX ? Math.max(...xs) : Math.max(...zs);
      for (const [x, z] of cells) {
        putE(x, z, yt, ridgeMat); putE(x, z, yt + 1, ridgeMat);
        const a = alongX ? x : z;
        if (o.oni !== false && (a === lo || a === hi) && hi > lo) { putE(x, z, yt + 2, ridgeMat); if (o.oni === 2) putE(x, z, yt + 3, ridgeMat); }
      }
    }
  }
  built(x0, x1, z0, z1);
  return { top: yb + 3 * nC };
}
let slopeCount = 0;

/**
 * Body of a hall: the rectangle [x0, x1) x [z0, z1), levels [y0, y1).
 *   pillars(x, z)       true where a ring cell carries a round-brick pillar
 *   wall(face, t, y, x, z)  material of a non-pillar ring cell (null = open)
 *   inner(x, z, y)      material of the inside (default: the hidden core)
 */
function body(o) {
  const { x0, x1, z0, z1, y0, y1 } = o;
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    const faces = [];
    if (z === z1 - 1) faces.push('s'); if (z === z0) faces.push('n');
    if (x === x1 - 1) faces.push('e'); if (x === x0) faces.push('w');
    if (!faces.length) {
      for (let y = y0; y < y1; y++) { const m = o.inner ? o.inner(x, z, y) : 'core'; if (m) put(x, z, y, m); }
      continue;
    }
    if (o.pillars(x, z)) { pillar(x, z, y0, y1, o.pillarMat); continue; }
    const f = faces[0], t = f === 's' || f === 'n' ? x - x0 : z - z0;
    for (let y = y0; y < y1; y++) { const m = o.wall(f, t, y, x, z); if (m) put(x, z, y, m); }
  }
  built(x0, x1, z0, z1);
}
/** Beam ring on top of a body, with brackets hanging one stud outside (under the eave slab). */
function bracketRing(x0, x1, z0, z1, y, beam, bracket, every = 1, inner = 'core') {
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    const ring = x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1;
    put(x, z, y, ring ? beam : inner);
  }
  if (!bracket) return;
  for (let x = x0 - 1; x <= x1; x++) for (let z = z0 - 1; z <= z1; z++) {
    const out = x === x0 - 1 || x === x1 || z === z0 - 1 || z === z1;
    if (!out) continue;
    const t = (x === x0 - 1 || x === x1) ? z - z0 : x - x0;
    if (((t % every) + every) % every === 0 || x < x0 && z < z0 || x >= x1 && z >= z1 || x < x0 && z >= z1 || x >= x1 && z < z0) putE(x, z, y, bracket, FL_HANG);
  }
}
/** Stone plinth (kidan) under a hall. */
function plinth(x0, x1, z0, z1, y0, y1, m = 'plinth') {
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) put(x, z, y, m);
}
/** Railing: posts every other cell along a path of cells, a rail on top of them. */
function railing(cells, y, post, rail) {
  cells.forEach(([x, z], n) => { if (n % 2 === 0 || n === cells.length - 1) putE(x, z, y, post); });
  for (const [x, z] of cells) putE(x, z, y + 1, rail);
}
const lineCells = (x0, z0, x1, z1) => { const out = []; const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)); for (let i = 0; i <= n; i++) out.push([x0 + Math.sign(x1 - x0) * i, z0 + Math.sign(z1 - z0) * i]); return out; };

/* ================================================================== 3. the main hall (hondo) and its stage */
// Floor of the hall and the stage at YF. Pillars every 3 studs in both directions stand on
// foundation stones on the slope; nuki beams tie them every 7 plates (at YF-2, YF-9, YF-16).
const YF = 26;
const NUKI = [YF - 2, YF - 9, YF - 16];
const XP = [-4, -1, 2, 5, 8, 11, 14, 17, 20];
const ZP = [-25, -22, -19, -16, -13, -10, -7, -4, -1, 2, 5];
const HALL = [-4, 21, -25, -3];                          // the hall itself: 25 x 22 studs
const WINGS = [-4, 21, -3, 3];                           // the two wing corridors (yokuro) and the stage between
const STAGE = [2, 15, -3, 6];                            // the stage (butai): 13 x 9 studs, about 190 m2
const inHallFloor = (x, z) => inBox(x, z, HALL) || inBox(x, z, WINGS) || inBox(x, z, STAGE);

function kakezukuri(xs, zs, inFloor) {
  const pillars = [];
  for (const x of xs) for (const z of zs) if (inFloor(x, z)) pillars.push([x, z]);
  const pset = new Set(pillars.map(p => p[0] + ',' + p[1]));
  const isP = (x, z) => pset.has(x + ',' + z);
  for (const L0 of NUKI) {
    // the beams along x at L0, the ones along z one plate higher: they cross at the pillars
    for (const [lines, cross, alongX] of [[zs, xs, true], [xs, zs, false]]) {
      const L = alongX ? L0 : L0 + 1;
      for (const a of lines) {
        const ps = cross.filter(b => (alongX ? isP(b, a) : isP(a, b)) && (alongX ? T(b, a) : T(a, b)) < L);
        let any = false;
        for (let n = 0; n + 1 < ps.length; n++) {
          const b0 = ps[n], b1 = ps[n + 1];
          if (b1 - b0 > 3) continue;
          const cells = [];
          for (let b = b0; b <= b1; b++) cells.push(alongX ? [b, a] : [a, b]);
          if (cells.some(([x, z]) => T(x, z) >= L)) continue;
          for (const [x, z] of cells) put(x, z, L, 'nuki');
          any = true;
        }
        // the beam ends run one stud past the outer pillars (kibana)
        if (any) for (const [b, s] of [[ps[0], -1], [ps[ps.length - 1], 1]]) {
          const [x, z] = alongX ? [b + s, a] : [a, b + s];
          const [px, pz] = alongX ? [b, a] : [a, b];
          if (get(px, pz, L) === MAT.nuki && T(x, z) < L && !get(x, z, L) && !inFloor(x, z)) put(x, z, L, 'nuki');
        }
      }
    }
  }
  // pillars between the beams, each on a foundation stone
  for (const [x, z] of pillars) {
    let y = T(x, z) + 1, first = true;
    while (y < YF - 1) {
      let e = y;
      while (e < YF - 1 && !get(x, z, e)) e++;
      if (e > y) { pillar(x, z, y, e, 'pillar', { base: first ? 'stone' : null }); first = false; }
      y = e + 1;
    }
  }
}
/** Joists at YF-1 and floor boards at YF over the floor and a veranda ring. */
function deck(cells) {
  for (const [x, z] of cells) { putE(x, z, YF - 1, 'joist'); putE(x, z, YF, 'floor'); }
}
function rectCells(x0, x1, z0, z1) { const out = []; for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) out.push([x, z]); return out; }

GROUP = 1;
kakezukuri(XP, ZP, inHallFloor);
GROUP = 2;
const CORRIDOR_Z = [-21, -16];
const hallVeranda = [
  ...rectCells(-5, -4, -26, -3), ...rectCells(21, 22, -26, -3), ...rectCells(-4, 21, -26, -25)
];
deck([...rectCells(-4, 21, -25, 3), ...rectCells(2, 15, 3, 6), ...hallVeranda]);
for (let x = -6; x < 23; x++) built(x, x + 1, -27, 8);
// railings: round the stage and the wings, and round the veranda (open where the corridor joins)
{
  const rp = 'rail-post', rr = 'rail';
  for (const line of [lineCells(-4, -3, -4, 2), lineCells(-3, 2, 1, 2), lineCells(2, 2, 2, 5), lineCells(3, 5, 13, 5),
    lineCells(14, 5, 14, 2), lineCells(15, 2, 19, 2), lineCells(20, 2, 20, -3)]) railing(line, YF + 1, rp, rr);
  railing(lineCells(-5, -4, -5, CORRIDOR_Z[1]), YF + 1, rp, rr);
  railing(lineCells(-5, CORRIDOR_Z[0] - 1, -5, -26), YF + 1, rp, rr);
  railing(lineCells(-4, -26, 21, -26), YF + 1, rp, rr);
  railing(lineCells(21, -25, 21, -4), YF + 1, rp, rr);
}

// the hall: open to the stage on the south (the raido behind raised shutters), shitomi-do lattice
// shutters on the other sides; round pillars of keyaki every 3 studs
GROUP = 3;
{
  const [x0, x1, z0, z1] = HALL;
  body({ x0, x1, z0, z1, y0: YF + 1, y1: YF + 10, pillarMat: 'pillar',
    pillars: (x, z) => (XP.includes(x) && (z === z0 || z === z1 - 1)) || ((x === x0 || x === x1 - 1) && ZP.includes(z)),
    wall: (f, t, y) => f === 's' ? null : y <= YF + 6 ? 'shitomi' : y === YF + 7 ? 'nageshi' : 'wood',
    inner: (x, z, y) => z === z1 - 2 ? (y <= YF + 6 ? 'shadow' : y === YF + 7 ? 'nageshi' : 'shitomi') : 'core' });
  bracketRing(x0, x1, z0, z1, YF + 10, 'beam', 'bracket', 3);
  // the inner sanctum: the gilded zushi of the eleven-headed, thousand-armed Kannon behind the raido
  for (const x of [5, 8, 11]) for (let y = YF + 1; y < YF + 6; y++) put(x, z0 + 3, y, 'gold');
}
// the wing corridors (yokuro): open, pillars and a ceiling beam
for (const [wx0, wx1] of [[-4, 3], [14, 21]]) {
  for (const x of XP.filter(x => x >= wx0 && x < wx1)) for (const z of [-1, 2]) pillar(x, z, YF + 1, YF + 7, 'pillar');
  for (let x = wx0; x < wx1; x++) for (let z = -3; z < 3; z++) {
    const beam = z === 2 || z === -1 || x === wx0 || x === wx1 - 1 || XP.includes(x);
    if (beam && !get(x, z, YF + 7)) put(x, z, YF + 7, 'beam');
  }
  built(wx0, wx1, -3, 3);
}
// roofs: the wings first (their ridges run north into the great roof), then the hall
GROUP = 4;
for (const [rx0, rx1] of [[-6, 4], [13, 23]]) {             // flush with the eave of the great roof
  roof({ x0: rx0, x1: rx1, z0: -9, z1: 4, yb: YF + 9, ns: [3, 2, 2], ew: [3, 2, 2], cap: { s: 1 }, open: { n: true }, order: 'ewsn',
    mat: 'bark', ridge: 'ridge', gable: 'gable-wood', gegyo: 'gold', eave: 'eave', eaveEdge: 'eave-edge' });
}
roof({ x0: -6, x1: 23, z0: -27, z1: -1, yb: YF + 12, ns: [4, 3, 3, 3, 2, 2, 2], ew: [3, 2, 2, 2, 2, 2, 2], order: 'snew',
  mat: 'bark', ridge: 'ridge', oni: 2, eave: 'eave', eaveEdge: 'eave-edge' });

/* ================================================================== 4. Oku-no-in */
// The inner hall east of the main hall, also on kakezukuri: its stage looks west to the main hall.
const XO = [31, 34, 37, 40, 43];
const ZO = [-22, -19, -16, -13, -10, -7];
const OKU = [34, 44, -22, -12];
const inOkuFloor = (x, z) => inBox(x, z, OKU) || inBox(x, z, [31, 44, -12, -6]) || inBox(x, z, [31, 34, -19, -12]);
GROUP = 1;
kakezukuri(XO, ZO, inOkuFloor);
GROUP = 10;
deck([...rectCells(31, 44, -22, -6).filter(([x, z]) => inOkuFloor(x, z)), ...rectCells(34, 44, -23, -22), ...rectCells(44, 45, -23, -12)]);
built(29, 46, -24, -4);
for (const line of [lineCells(31, -19, 31, -7), lineCells(32, -7, 43, -7), lineCells(43, -8, 43, -11), lineCells(32, -19, 33, -19),
  lineCells(34, -23, 44, -23), lineCells(44, -22, 44, -13)]) railing(line, YF + 1, 'rail-post', 'rail');
{
  const [x0, x1, z0, z1] = OKU;
  body({ x0, x1, z0, z1, y0: YF + 1, y1: YF + 8, pillarMat: 'pillar',
    pillars: (x, z) => (XO.includes(x) && (z === z0 || z === z1 - 1)) || ((x === x0 || x === x1 - 1) && ZO.includes(z)),
    wall: (f, t, y) => f === 's' || f === 'w' ? null : y <= YF + 5 ? 'shitomi' : y === YF + 6 ? 'nageshi' : 'wood',
    inner: (x, z, y) => (z === z1 - 2 || x === x0 + 1) ? (y <= YF + 5 ? 'shadow' : 'shitomi') : 'core' });
  bracketRing(x0, x1, z0, z1, YF + 8, 'beam', 'bracket', 3);
  roof({ x0: 32, x1: 46, z0: -24, z1: -10, yb: YF + 10, ns: [3, 3, 2, 2], ew: [3, 2, 2, 2], order: 'snew',
    mat: 'bark', ridge: 'ridge', eave: 'eave', eaveEdge: 'eave-edge' });
}

/* ================================================================== 5. Nio-mon (the Deva gate) */
// A two-storeyed romon in vermilion, facing west over the stairs from Kiyomizu-zaka; irimoya roof
// of cypress bark. The two Nio stand in the front side bays behind lattice.
GROUP = 5;
{
  const g = terraceLevel(-64, -28);                       // the Nio-mon terrace
  const x0 = -68, x1 = -63, z0 = -33, z1 = -23;
  const PX = [-68, -66, -64], PZ = [-33, -30, -27, -24];
  const passage = z => z === -29 || z === -28;
  const sideBay = z => (z >= -32 && z <= -31) || (z >= -26 && z <= -25);
  plinth(x0 - 1, x1 + 1, z0 - 1, z1 + 1, g + 1, g + 2);
  body({ x0, x1, z0, z1, y0: g + 2, y1: g + 8, pillarMat: 'verm',
    pillars: (x, z) => PX.includes(x) && PZ.includes(z),
    wall: (f, t, y, x, z) => {
      if (f === 'w' || f === 'e') return passage(z) ? null : y === g + 7 ? 'verm' : 'verm-lattice';
      return y === g + 2 || y === g + 7 ? 'verm' : 'plaster';
    },
    inner: (x, z, y) => {
      if (passage(z)) return null;
      if (x === -66 && PZ.includes(z)) return 'verm';
      if (x === -67 && sideBay(z)) return y <= g + 6 ? 'nio' : 'verm';
      return y <= g + 6 ? 'shadow' : 'verm';
    } });
  bracketRing(x0, x1, z0, z1, g + 8, 'verm', 'bracket-verm', 1, 'verm');
  // the balcony all round, with its railing
  for (let x = x0 - 1; x <= x1; x++) for (let z = z0 - 1; z <= z1; z++) put(x, z, g + 9, 'verm');
  railing([...lineCells(x0 - 1, z0 - 1, x0 - 1, z1), ...lineCells(x0, z1, x1, z1), ...lineCells(x1, z1 - 1, x1, z0 - 1), ...lineCells(x1 - 1, z0 - 1, x0, z0 - 1)], g + 10, 'verm', 'verm');
  // upper storey: doors in the middle, green lattice windows at the sides
  const UX = [-67, -65], UZ = [-32, -30, -27, -25];
  body({ x0: -67, x1: -64, z0: -32, z1: -24, y0: g + 10, y1: g + 14, pillarMat: 'verm',
    pillars: (x, z) => UX.includes(x) && UZ.includes(z),
    wall: (f, t, y, x, z) => {
      if (y === g + 13) return 'verm';
      if (f === 'w' || f === 'e') return passage(z) ? 'door-verm' : (y === g + 11 || y === g + 12) ? 'window' : 'plaster';
      return 'plaster';
    } });
  bracketRing(-67, -64, -32, -24, g + 14, 'verm', 'bracket-verm', 1);
  roof({ x0: -70, x1: -61, z0: -35, z1: -21, yb: g + 16, ns: [3, 2], ew: [3, 2], cap: { n: 1, s: 1 }, order: 'ewns',
    mat: 'bark', ridge: 'ridge', gable: 'plaster', gegyo: 'gold', eave: 'verm', eaveEdge: 'tip' });
  built(x0 - 1, x1 + 1, z0 - 1, z1 + 1, 1);
}

// Kiyomizu-zaka: two-storeyed machiya with lattice fronts, white upper walls and tiled roofs
function machiya(x0, x1, z0, z1, face) {
  const g = T(x0, z0);
  const front = (f, t) => f === face && t > 0;
  body({ x0, x1, z0, z1, y0: g + 1, y1: g + 7, pillarMat: 'machiya-wood',
    pillars: (x, z) => (x === x0 || x === x1 - 1) && (z === z0 || z === z1 - 1),
    wall: (f, t, y) => y === g + 6 ? 'machiya-wood' : front(f, t) ? (t === 2 && y <= g + 4 ? 'noren' : 'koshi') : 'machiya-wood' });
  bracketRing(x0, x1, z0, z1, g + 7, 'machiya-wood', null);
  body({ x0, x1, z0, z1, y0: g + 8, y1: g + 11, pillarMat: 'machiya-wood',
    pillars: (x, z) => (x === x0 || x === x1 - 1) && (z === z0 || z === z1 - 1),
    wall: (f, t, y) => front(f, t) && y === g + 9 && t % 2 === 1 ? 'mushiko' : 'plaster' });
  roof({ x0, x1, z0: z0 - 1, z1: z1 + 1, yb: g + 12, ns: [3, 2, 2], ew: [3, 2, 2], cap: { e: 0, w: 0 }, order: 'nsew',
    mat: 'tile', ridge: 'tile-ridge', oni: false, gable: 'plaster', eave: 'machiya-wood', eaveEdge: 'machiya-wood' });
}
GROUP = 5;
machiya(-83, -77, -45, -37, 's');
machiya(-76, -70, -45, -37, 's');
machiya(-83, -77, -20, -12, 'n');
machiya(-76, -70, -20, -12, 'n');

/* ================================================================== 6. Sai-mon, the bell tower */
GROUP = 6;
{
  // Sai-mon (the west gate): an eight-legged gate at the top of the stairs, gable roof
  const PX = [-52, -49], PZ = [-22, -20, -17, -15];
  const passage = z => z === -19 || z === -18;
  plinth(-53, -47, -23, -13, 23, 24);
  body({ x0: -52, x1: -48, z0: -22, z1: -14, y0: 24, y1: 30, pillarMat: 'verm',
    pillars: (x, z) => PX.includes(x) && PZ.includes(z),
    wall: (f, t, y, x, z) => {
      if (f === 'w' || f === 'e') return passage(z) ? null : y === 29 ? 'verm' : 'verm-lattice';
      return y === 24 || y === 29 ? 'verm' : 'plaster';
    },
    inner: (x, z, y) => passage(z) ? null : y === 29 ? 'verm' : 'shadow' });
  bracketRing(-52, -48, -22, -14, 30, 'verm', 'bracket-verm', 1, 'verm');
  roof({ x0: -54, x1: -46, z0: -23, z1: -13, yb: 32, ns: [3, 2], ew: [3, 2], cap: { n: 0, s: 0 }, order: 'ewns',
    mat: 'bark', ridge: 'ridge', gable: 'plaster', gegyo: 'gold', eave: 'verm', eaveEdge: 'tip' });
  built(-53, -47, -23, -13, 1);
  // the bell tower (shoro): four pillars, the bronze bell hanging from the beams, tiled irimoya roof
  plinth(-48, -42, -38, -32, 23, 24);
  for (const [x, z] of [[-47, -37], [-44, -37], [-47, -34], [-44, -34]]) pillar(x, z, 24, 33, 'verm');
  bracketRing(-47, -43, -37, -33, 33, 'verm', 'bracket-verm', 1, 'verm');
  special('round-brick', -46, -36, 30, 'bell', { sx: 2, sz: 2 });
  special('round-plate', -46, -36, 29, 'bell', { sx: 2, sz: 2 });
  roof({ x0: -49, x1: -41, z0: -39, z1: -31, yb: 35, ns: [3, 2], ew: [3, 2], cap: { e: 1, w: 1 }, order: 'nsew',
    mat: 'tile', ridge: 'tile-ridge', gable: 'plaster', gegyo: 'gold', eave: 'verm', eaveEdge: 'tip' });
  built(-48, -42, -38, -32, 1);
}

/* ================================================================== 7. the three-storied pagoda */
// 31 m, the largest three-storied pagoda in Japan: vermilion with white walls and green windows,
// tiled roofs with yellow rafter ends, a bronze sorin with gilded rings.
GROUP = 7;
{
  const cx = -36, cz = -18;
  const sq = r => [cx - r, cx + r + 1, cz - r, cz + r + 1];
  plinth(...sq(4), 23, 25);
  for (let z = cz - 1; z <= cz + 1; z++) put(cx - 5, z, 23, 'plinth');         // a step on the approach side
  const storeys = [{ y0: 25, h: 5, R: 5 }, { y0: 38, h: 3, R: 5 }, { y0: 49, h: 3, R: 4 }];
  for (const [n, s] of storeys.entries()) {
    const [x0, x1, z0, z1] = sq(2), yTop = s.y0 + s.h - 1;
    body({ x0, x1, z0, z1, y0: s.y0, y1: s.y0 + s.h, pillarMat: 'verm',
      pillars: (x, z) => (x === x0 || x === x1 - 1) && (z === z0 || z === z1 - 1),
      wall: (f, t, y) => {
        if (y === s.y0 || y === yTop) return 'verm';
        if (t === 2) return 'door-verm';
        return n === 0 && y !== s.y0 + 1 ? 'window' : 'plaster';
      } });
    bracketRing(x0, x1, z0, z1, s.y0 + s.h, 'verm', 'bracket-verm', 1);
    roof({ ...Object.fromEntries(['x0', 'x1', 'z0', 'z1'].map((k, i) => [k, sq(s.R)[i]])), yb: s.y0 + s.h + 2, ns: [3, 2], ew: [3, 2],
      order: 'snew', mat: 'tile', eave: 'verm', eaveEdge: 'tip' });
  }
  // the sorin: roban, fukubachi, the rings, suien and the jewel
  for (const [x, z] of rectCells(...sq(1))) put(x, z, 60, 'sorin');
  special('round-brick', cx, cz, 61, 'sorin');
  special('round-plate', cx, cz, 64, 'gold');
  for (let n = 0; n < 6; n++) special('round-plate', cx, cz, 65 + n, n % 2 ? 'sorin' : 'gold');
  special('round-brick', cx, cz, 71, 'gold');
  special('cone', cx, cz, 74, 'gold');
  built(...sq(5), 1);
}

/* ================================================================== 8. the sutra hall, the founder's hall */
GROUP = 8;
{
  // Kyodo (sutra hall): vermilion, tiled irimoya roof, facing the approach
  const PX = [-30, -28, -24, -22], PZ = [-36, -33, -30];
  plinth(-31, -20, -37, -28, 23, 24);
  body({ x0: -30, x1: -21, z0: -36, z1: -29, y0: 24, y1: 33, pillarMat: 'verm',
    pillars: (x, z) => PX.includes(x) && PZ.includes(z),
    wall: (f, t, y) => {
      if (y === 24 || y === 32) return 'verm';
      if (f === 's' && t >= 3 && t <= 5) return 'door-verm';
      if (f === 's' && (t === 1 || t === 7) && y >= 26 && y <= 30) return 'window';
      return 'plaster';
    } });
  bracketRing(-30, -21, -36, -29, 33, 'verm', 'bracket-verm', 1);
  roof({ x0: -32, x1: -19, z0: -38, z1: -27, yb: 35, ns: [3, 2, 2], ew: [3, 2, 2], cap: { e: 1, w: 1 }, order: 'nsew',
    mat: 'tile', ridge: 'tile-ridge', oni: 2, gable: 'plaster', gegyo: 'gold', eave: 'verm', eaveEdge: 'tip' });
  // Tamura-do (founder's hall): vermilion, cypress-bark irimoya roof
  const TX = [-28, -26, -24, -22], TZ = [-16, -11];
  plinth(-29, -20, -17, -9, 23, 24);
  body({ x0: -28, x1: -21, z0: -16, z1: -10, y0: 24, y1: 32, pillarMat: 'verm',
    pillars: (x, z) => TX.includes(x) && TZ.includes(z),
    wall: (f, t, y) => {
      if (y === 24 || y === 31) return 'verm';
      if (f === 'n' && t === 3) return 'door-verm';
      if (f === 'n' && (t === 1 || t === 5) && y >= 26 && y <= 29) return 'window';
      return 'plaster';
    } });
  bracketRing(-28, -21, -16, -10, 32, 'verm', 'bracket-verm', 1);
  roof({ x0: -30, x1: -19, z0: -18, z1: -8, yb: 34, ns: [3, 2, 2], ew: [3, 2, 2], cap: { e: 1, w: 1 }, order: 'nsew',
    mat: 'bark', ridge: 'ridge', gable: 'plaster', gegyo: 'gold', eave: 'verm', eaveEdge: 'tip' });
}

/* ================================================================== 9. Todoroki-mon and the corridor */
GROUP = 9;
{
  const PX = [-17, -14], PZ = [-22, -20, -17, -15];
  const passage = z => z === -19 || z === -18;
  plinth(-18, -12, -23, -13, 23, 24);
  body({ x0: -17, x1: -13, z0: -22, z1: -14, y0: 24, y1: 30, pillarMat: 'pillar',
    pillars: (x, z) => PX.includes(x) && PZ.includes(z),
    wall: (f, t, y, x, z) => {
      if (f === 'w' || f === 'e') return passage(z) ? null : y === 29 ? 'beam' : 'shitomi';
      return y === 24 || y === 29 ? 'beam' : 'wood';
    },
    inner: (x, z, y) => passage(z) ? null : y === 29 ? 'beam' : 'shadow' });
  bracketRing(-17, -13, -22, -14, 30, 'beam', 'bracket', 1, 'beam');
  roof({ x0: -19, x1: -11, z0: -23, z1: -13, yb: 32, ns: [3, 2], ew: [3, 2], cap: { n: 0, s: 0 }, order: 'ewns',
    mat: 'bark', ridge: 'ridge', gable: 'gable-wood', gegyo: 'gold', eave: 'eave', eaveEdge: 'eave-edge' });
  built(-18, -12, -23, -13, 1);
  // the roofed corridor up to the west veranda of the main hall
  plinth(-12, -5, CORRIDOR_Z[0], CORRIDOR_Z[1], 23, 26);
  for (let x = -12; x < -5; x++) for (let z = CORRIDOR_Z[0]; z < CORRIDOR_Z[1]; z++) put(x, z, 26, x === -12 ? 'step' : 'floor');
  for (const x of [-10, -8, -6]) for (const z of [CORRIDOR_Z[0], CORRIDOR_Z[1] - 1]) pillar(x, z, 27, 32, 'pillar');
  for (let x = -11; x < -5; x++) for (let z = CORRIDOR_Z[0]; z < CORRIDOR_Z[1]; z++) put(x, z, 32, 'beam');
  roof({ x0: -11, x1: -6, z0: -22, z1: -15, yb: 34, ns: [3], ew: [3], cap: { w: 0 }, open: { e: true }, order: 'nsew',
    mat: 'bark', ridge: 'ridge', oni: false, gable: 'gable-wood', eave: 'eave', eaveEdge: 'eave-edge' });
  built(-12, -5, -22, -15);
}

/* ================================================================== 10. Otowa-no-taki */
// Three streams of spring water fall from stone spouts into the pool below Oku-no-in; a bark roof
// shelters the place where pilgrims drink; red-felt benches of the tea stall.
GROUP = 11;
{
  for (const x of [26, 28, 30]) { pillar(x, -5, OT, 13, 'fall'); put(x, -5, 13, 'spout'); }
  for (const x of [23, 33]) pillar(x, -1, OT + 1, 17, 'pillar');
  roof({ x0: 22, x1: 35, z0: -8, z1: 0, yb: 18, ns: [3, 3], ew: [3, 3], cap: { e: 0, w: 0 }, open: { n: true }, order: 'snew',
    mat: 'bark', gable: 'gable-wood', eave: 'eave', eaveEdge: 'eave-edge' });
  for (const [x0, z0] of [[22, 3], [30, 3]]) for (let x = x0; x < x0 + 4; x++) { put(x, z0, OT + 1, 'wood'); put(x, z0, OT + 2, 'felt'); }
  built(20, 37, -9, 6);
}

/* ================================================================== 11. Koyasu-no-to */
// The small three-storied pagoda of easy childbirth on the hill across the valley.
GROUP = 12;
{
  const cx = 42, cz = 38, g = T(42, 38);
  const sq = r => [cx - r, cx + r + 1, cz - r, cz + r + 1];
  plinth(...sq(3), g + 1, g + 2);
  for (const [n, y0] of [g + 2, g + 10, g + 18].entries()) {
    const [x0, x1, z0, z1] = sq(1);
    body({ x0, x1, z0, z1, y0, y1: y0 + 3, pillarMat: 'verm',
      pillars: (x, z) => (x === x0 || x === x1 - 1) && (z === z0 || z === z1 - 1),
      wall: (f, t, y) => y === y0 + 2 ? 'verm' : t === 1 && n === 0 ? 'door-verm' : 'plaster' });
    bracketRing(x0, x1, z0, z1, y0 + 3, 'verm', 'bracket-verm', 1);
    roof({ ...Object.fromEntries(['x0', 'x1', 'z0', 'z1'].map((k, i) => [k, sq(3)[i]])), yb: y0 + 5, ns: [3], ew: [3],
      order: 'snew', mat: 'bark', eave: 'verm', eaveEdge: 'tip' });
  }
  special('round-brick', cx, cz, g + 26, 'sorin');
  for (let n = 0; n < 4; n++) special('round-plate', cx, cz, g + 29 + n, n % 2 ? 'sorin' : 'gold');
  special('cone', cx, cz, g + 33, 'gold');
  built(...sq(4), 1);
}

/* ================================================================== 12. torii, lanterns */
GROUP = 13;
{
  // the vermilion torii of Jishu-jinja, north of the main hall
  const tz = -33, tx0 = 5, tx1 = 11;
  for (let x = tx0; x <= tx1; x++) put(x, tz, 29, 'verm');                    // nuki
  for (const x of [tx0, tx1]) { pillar(x, tz, 23, 29, 'verm'); pillar(x, tz, 30, 32, 'verm'); }
  for (let x = tx0 - 1; x <= tx1 + 1; x++) put(x, tz, 32, 'verm');            // shimaki
  for (let x = tx0 - 2; x <= tx1 + 2; x++) put(x, tz, 33, 'kasagi');          // kasagi
  built(tx0 - 2, tx1 + 3, tz - 1, tz + 2);
  // stone lanterns along the approach and at the waterfall
  const lantern = (x, z) => {
    const y = T(x, z) + 1;
    special('brick', x, z, y, 'lantern-stone');
    special('round-plate', x, z, y + 3, 'lantern-stone');
    special('brick', x, z, y + 4, 'lantern-light');
    special('cone', x, z, y + 7, 'lantern-stone');
    built(x, x + 1, z, z + 1, 1);
  };
  for (const [x, z] of [[-45, -22], [-45, -14], [-28, -22], [-20, -22], [-8, -23], [-60, -37], [-61, -22], [21, 1], [35, 1], [8, -30]]) lantern(x, z);
}

/* ================================================================== 13. trees */
// Autumn: maples in crimson, scarlet, orange and gold (a few still green) on the slopes and in the
// valley below the stage; cedars and evergreen oaks on Otowa-yama and behind the halls.
const TREES = {
  red:       { top: 'maple-red', light: 'maple-scarlet', prof: [1, 2, 2.8, 3.2, 3.3, 3.0, 2.4, 1.4] },
  orange:    { top: 'maple-orange', light: 'maple-amber', prof: [1, 2, 2.8, 3.1, 3.1, 2.8, 2.2, 1.3] },
  yellow:    { top: 'maple-yellow', light: 'maple-gold', prof: [1, 1.9, 2.6, 2.9, 2.9, 2.6, 2.0, 1.2] },
  green:     { top: 'maple-green', light: 'maple-lime', prof: [1, 2, 2.7, 3.0, 3.0, 2.7, 2.0, 1.2] },
  evergreen: { top: 'evergreen', light: 'evergreen-light', prof: [1, 2, 2.9, 3.4, 3.5, 3.4, 3.0, 2.3, 1.4] },
  cedar:     { top: 'cedar', light: 'cedar-light', prof: [1, 2, 2.4, 2.3, 2.1, 1.9, 1.7, 1.5, 1.3, 1.1, 1, 1, 0.5], cone: true }
};
const TREE_FAMILY = {};
for (const [k, t] of Object.entries(TREES)) { TREE_FAMILY[t.top] = 'tree-' + k; TREE_FAMILY[t.light] = 'tree-' + k; }
const TREE_GROUND = new Set(['moss', 'undergrowth', 'leaf-litter']);
let treeCount = 0;
function tree(x, z, kind, scale) {
  const S = TREES[kind], g = T(x, z);
  const trunkN = scale < 0.8 ? 1 : 2;
  for (let y = g + 1; y <= g + 3 * trunkN + S.prof.length; y++) if (get(x, z, y)) return false;
  for (let n = 0; n < trunkN; n++) special('round-brick', x, z, g + 1 + 3 * n, 'trunk');
  const y0 = g + 1 + 3 * trunkN;
  const prof = S.prof.map(r => Math.max(1, r * scale));
  const nL = Math.max(4, Math.round(prof.length * (0.75 + 0.25 * scale)));
  for (let n = 0; n < nL; n++) {
    const r = prof[Math.min(prof.length - 1, Math.floor(n * prof.length / nL))];
    const light = S.cone ? n >= nL - 4 && n % 2 === 1 : n >= nL - 2;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      if (dx * dx + dz * dz > r * r + 1e-9) continue;
      const px = x + dx, pz = z + dz;
      if (isBuilt(px, pz)) continue;
      putE(px, pz, y0 + n, light ? S.light : S.top);
    }
  }
  treeCount++;
  return true;
}
GROUP = 14;
for (let gx = X0 + 1; gx < X1 - 2; gx += 7) for (let gz = Z0 + 1; gz < Z1 - 2; gz += 7) {
  const x = Math.min(X1 - 3, gx + Math.floor(rnd() * 5)), z = Math.min(Z1 - 3, gz + Math.floor(rnd() * 5));
  const r0 = rnd(), r1 = rnd(), r2 = rnd();
  if (!TREE_GROUND.has(surfaceMat(x, z)) || isBuilt(x, z, 3)) continue;
  const mountain = x >= 46 || z < -40;
  const plateau = z < cliffZ(x) && !mountain;
  if (plateau && r0 < 0.35) continue;
  if (x >= -8 && x < 26 && z >= 6 && z < 24 && r0 < 0.55) continue;   // keep the pillars of the stage in view
  if (r0 > (mountain ? 0.9 : 0.86)) continue;
  let kind;
  if (mountain) kind = r1 < 0.5 ? 'cedar' : r1 < 0.72 ? 'evergreen' : r1 < 0.88 ? 'red' : 'yellow';
  else kind = r1 < 0.36 ? 'red' : r1 < 0.58 ? 'orange' : r1 < 0.72 ? 'yellow' : r1 < 0.84 ? 'green' : 'evergreen';
  tree(x, z, kind, 0.62 + r2 * 0.5);
}
// the far side of the ravine, seen behind the stage from Oku-no-in: a denser wood
for (let gx = -20; gx < X1 - 3; gx += 5) for (let gz = 18; gz < Z1 - 3; gz += 5) {
  const x = gx + Math.floor(rnd() * 4), z = Math.min(Z1 - 3, gz + Math.floor(rnd() * 4));
  const r0 = rnd(), r1 = rnd(), r2 = rnd();
  if (!TREE_GROUND.has(surfaceMat(x, z)) || isBuilt(x, z, 2) || r0 > 0.8) continue;
  tree(x, z, r1 < 0.38 ? 'red' : r1 < 0.6 ? 'orange' : r1 < 0.74 ? 'yellow' : r1 < 0.86 ? 'green' : 'evergreen', 0.6 + r2 * 0.45);
}
// the maples right below the stage, the famous view from Oku-no-in
for (const [x, z, kind, s] of [[-7, 7, 'red', 1.0], [24, 8, 'red', 0.9], [18, 10, 'orange', 0.8], [-2, 15, 'yellow', 0.9],
  [10, 16, 'red', 1.05], [27, 16, 'orange', 0.95], [-12, 11, 'red', 0.85]]) if (!isBuilt(x, z, 2) && TREE_GROUND.has(surfaceMat(x, z))) tree(x, z, kind, s);

/* ================================================================== 14. packing */
const FAMILY = {
  ...TREE_FAMILY,
  'base': 'ground', 'soil': 'ground', 'earth': 'ground', 'ishigaki': 'ground', 'moss': 'ground', 'undergrowth': 'ground', 'leaf-litter': 'ground',
  'gravel': 'ground', 'paving': 'ground', 'step': 'ground', 'street': 'ground', 'path': 'ground', 'water': 'ground',
  'bark': 'roof', 'tile': 'roof', 'ridge': 'roof', 'tile-ridge': 'roof', 'gable-wood': 'roof', 'roof-core': 'roof',
  'pillar': 'wood', 'nuki': 'wood', 'joist': 'wood', 'floor': 'wood', 'shitomi': 'wood', 'nageshi': 'wood', 'wood': 'wood', 'beam': 'wood',
  'shadow': 'wood', 'core': 'wood', 'eave': 'wood', 'eave-edge': 'wood', 'bracket': 'wood', 'rail': 'wood', 'rail-post': 'wood',
  'machiya-wood': 'verm', 'koshi': 'verm', 'noren': 'verm', 'mushiko': 'verm',
  'verm': 'verm', 'verm-lattice': 'verm', 'plaster': 'verm', 'window': 'verm', 'door-verm': 'verm', 'tip': 'verm', 'bracket-verm': 'verm', 'nio': 'verm',
  'plinth': 'plinth', 'stone': 'plinth'
};
const famId = new Map();
const famOf = m => { const f = FAMILY[MATS[m]] || MATS[m]; if (!famId.has(f)) famId.set(f, famId.size + 1); return famId.get(f); };
// hidden or textured surfaces: plates (studs on top) are fine
const NO_TILE = new Set(['base', 'soil', 'core', 'moss', 'undergrowth', 'leaf-litter', 'earth', 'shadow', ...Object.keys(TREE_FAMILY)]);

/** Closure: every voxel must clip onto something below — directly, or through a straight run
 *  of its family that one part can span. Otherwise it is given up (and reported). */
let closureRemoved = 0;
const closureBy = {};
{
  const filled = (i, k, j) => gv(i, k, j) !== 0 && !slopeFront[idx(i, k, j)];
  const direct = (i, k, j) => j === 0 || filled(i, k, j - 1);
  const runOK = (i, k, j) => {
    if (direct(i, k, j)) return true;
    if ((flags[idx(i, k, j)] & FL_HANG) && gv(i, k, j + 1)) return true;
    const f = famOf(gv(i, k, j));
    for (const [di, dk] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const cells = [[i + di, k], [i, k + dk], [i + di, k + dk]];
      if (cells.every(([a, b]) => gv(a, b, j) && gv(a, b, j) !== MAT.reserved && famOf(gv(a, b, j)) === f) && cells.some(([a, b]) => direct(a, b, j))) return true;
    }
    for (const [di, dk] of N4) for (let t = 1; t < 8; t++) {
      const a = i + di * t, b = k + dk * t, m = gv(a, b, j);
      if (!m || m === MAT.reserved || famOf(m) !== f) break;
      if (direct(a, b, j)) return true;
    }
    // a plate-sized rectangle of the family (up to 6 x 6) reaching a supported cell, e.g. the
    // corner of a deep eave slab
    const same = (a, b) => { const m = gv(a, b, j); return m && m !== MAT.reserved && famOf(m) === f; };
    for (let da = -5; da <= 5; da++) for (let db = -5; db <= 5; db++) {
      if (!direct(i + da, k + db, j) || !same(i + da, k + db)) continue;
      let ok = true;
      for (let a = Math.min(0, da); a <= Math.max(0, da) && ok; a++) for (let b = Math.min(0, db); b <= Math.max(0, db); b++) if (!same(i + a, k + b)) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  };
  for (let j = 1; j < NY; j++) for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
    const m = gv(i, k, j);
    if (!m || m === MAT.reserved || runOK(i, k, j)) continue;
    closureBy[MATS[m]] = (closureBy[MATS[m]] || 0) + 1;
    if (process.env.DEBUG_CLOSURE) console.log('closure', MATS[m], i + X_OFF, j - YS, k + Z_OFF);
    vox[idx(i, k, j)] = 0; flags[idx(i, k, j)] = 0; closureRemoved++;
  }
}
// hidden = no open face (such voxels are colour wildcards within their family)
const hidden = new Uint8Array(NX * NZ * NY);
for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
  const id = idx(i, k, j);
  if (!vox[id]) continue;
  let open = false;
  for (const [di, dk, dj] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const a = i + di, b = k + dk, c = j + dj;
    if (c < 0) continue;
    if (!inGrid(a, b, c) || !vox[idx(a, b, c)] || slopeFront[idx(a, b, c)]) { open = true; break; }
  }
  hidden[id] = open ? 0 : 1;
}

const parts = [];
const occ = new Uint8Array(NX * NZ * NY);                 // 1 = taken by a placed part
const studOwner = new Int32Array(NX * NZ * NY).fill(-1);  // part whose studs point up into this voxel
const grounded = [], partAbove = [], partBelow = [];
const dropped = [];

function sizeList(shape) {
  const out = [], seen = new Set();
  for (const [w, d] of PARTS[shape].sizes) for (const [a, b] of [[w, d], [d, w]]) { const k = a + 'x' + b; if (!seen.has(k)) { seen.add(k); out.push([a, b]); } }
  return out.sort((p, q) => q[0] * q[1] - p[0] * p[1]);
}
const SIZES = { brick: sizeList('brick'), plate: sizeList('plate'), tile: sizeList('tile') };

function addPart(shape, sx, sz, i, j, k, color, { rotation = null, h = null, g = 0 } = {}) {
  const Pt = PARTS[shape];
  const height = h ?? Pt.heights[0];
  let width, depth, rot;
  if (rotation !== null) { rot = rotation; const sw = rot === 90 || rot === 270; width = sw ? sz : sx; depth = sw ? sx : sz; }
  else if (Pt.sizes.some(([w, d]) => w === sx && d === sz)) { width = sx; depth = sz; rot = 0; }
  else { width = sz; depth = sx; rot = 90; }
  const b = { shape, width, depth, height, x: i, y: j, z: k, rotation: rot, color };
  const nb = core.normalizeModel({ version: 2, blocks: [{ id: 'p', ...b, step: 1 }] }).blocks[0];
  for (let a = 0; a < sx; a++) for (let c = 0; c < sz; c++) for (let t = 0; t < height; t++) {
    if (occ[idx(i + a, k + c, j + t)]) throw new Error(`collision: ${shape} ${sx}x${sz} at ${i + X_OFF},${j - YS},${k + Z_OFF}`);
  }
  const pi = parts.length;
  const below = new Set();
  for (let a = 0; a < sx; a++) for (let c = 0; c < sz; c++) for (let t = 0; t < height; t++) occ[idx(i + a, k + c, j + t)] = 1;
  for (const [cx, cz] of nb.bottomCells) { const o = j > 0 ? studOwner[idx(cx, cz, j)] : -1; if (o >= 0) below.add(o); }
  if (j + height < NY) for (const [cx, cz] of nb.topCells) studOwner[idx(cx, cz, j + height)] = pi;
  parts.push({ ...b, g });
  partBelow.push(below); partAbove.push(new Set());
  for (const o of below) partAbove[o].add(pi);
  grounded.push(false);
  if (j === 0 || [...below].some(o => grounded[o])) groundFrom(pi);
  return pi;
}
function groundFrom(pi) {
  const q = [pi]; grounded[pi] = true;
  while (q.length) { const p = q.pop(); for (const n of [...partAbove[p], ...partBelow[p]]) if (!grounded[n]) { grounded[n] = true; q.push(n); } }
}

const WILD = -1;
/**
 * Cover one plate level. Candidates: bricks (three voxels of one family, top covered), tiles
 * (exposed top) and plates. Every part covers a grounded stud below, or hangs (all its voxels
 * hang-flagged). Strict candidates keep every visible voxel's colour; relaxed ones (a last
 * resort) recolour visible voxels within the family.
 */
function packLevel(j, cells) {
  const cellSet = new Map(cells.map(([i, k]) => [i * 1000 + k, [i, k]]));
  const info = new Map();
  for (const [key, [i, k]] of cellSet) {
    const id = idx(i, k, j), m = vox[id], f = famOf(m);
    const exposed = j + 1 >= NY || !vox[idx(i, k, j + 1)] || slopeFront[idx(i, k, j + 1)];
    const col = hidden[id] ? WILD : m;
    let brickCol = null;
    if (!exposed && j + 3 < NY) {
      const ids = [id, idx(i, k, j + 1), idx(i, k, j + 2)];
      const ok = ids.every(t => vox[t] && vox[t] !== MAT.reserved && famOf(vox[t]) === f && !occ[t]) && vox[idx(i, k, j + 3)] && !slopeFront[idx(i, k, j + 3)] && !(flags[ids[1]] & FL_HANG) && !(flags[ids[2]] & FL_HANG) && grp[ids[1]] === grp[id] && grp[ids[2]] === grp[id];
      if (ok) {
        const vis = new Set(ids.filter(t => !hidden[t]).map(t => vox[t]));
        brickCol = vis.size === 0 ? WILD : vis.size === 1 ? [...vis][0] : 'mixed';
      }
    }
    const sup = j === 0 ? -2 : studOwner[id];
    info.set(key, { m, f, col, exposed, brickCol, sup, hang: (flags[id] & FL_HANG) !== 0, g: grp[id] });
  }
  const parity = (j % 2) === 0;
  const cands = [], byCell = new Map([...cellSet.keys()].map(k => [k, []]));
  for (const [key, [i, k]] of cellSet) {
    const c0 = info.get(key);
    for (const shape of ['brick', 'plate', 'tile']) {
      if (shape === 'brick' && c0.brickCol === null) continue;
      if (shape === 'tile' && (!c0.exposed || NO_TILE.has(MATS[c0.m]))) continue;
      for (const [a, b] of SIZES[shape]) {
        const rc = [];
        let ok = true, grounds = 0, allHang = true, exposedCells = 0;
        const sups = new Set(), colors = new Map();
        for (let p = 0; p < a && ok; p++) for (let q = 0; q < b; q++) {
          const kk = (i + p) * 1000 + (k + q), ci = info.get(kk);
          if (!ci || ci.f !== c0.f || ci.g !== c0.g) { ok = false; break; }
          if (shape === 'brick' && ci.brickCol === null) { ok = false; break; }
          if (shape === 'tile' && (!ci.exposed || NO_TILE.has(MATS[ci.m]))) { ok = false; break; }
          const cc = shape === 'brick' ? ci.brickCol : ci.col;
          if (cc === 'mixed') colors.set('mixed', 99);
          else if (cc !== WILD) colors.set(cc, (colors.get(cc) || 0) + 1);
          if (ci.exposed && !NO_TILE.has(MATS[ci.m])) exposedCells++;
          if (!ci.hang) allHang = false;
          if (ci.sup === -2) grounds++;
          else if (ci.sup >= 0) { sups.add(ci.sup); if (grounded[ci.sup]) grounds++; }
          rc.push(kk);
        }
        if (!ok) continue;
        if (!grounds && !(allHang && shape === 'plate')) continue;
        const strict = colors.size <= 1 && !colors.has('mixed');
        let color;
        if (strict) color = colors.size ? [...colors.keys()][0] : c0.m;
        else { color = [...colors].filter(([c]) => c !== 'mixed').sort((x, y) => y[1] - x[1])[0]?.[0] ?? c0.m; }
        const hgt = shape === 'brick' ? 3 : 1;
        let score = (grounds ? 1e6 : 0) + (strict ? 5e5 : 0) + a * b * hgt * 20 + Math.min(sups.size, 4) * (shape === 'brick' ? 25 : 40) + ((a >= b) === parity ? 4 : 0);
        if (shape === 'plate' && exposedCells) score -= 3e5 + exposedCells * 50;   // studs on show: last resort
        const ci = cands.length;
        cands.push({ i, k, a, b, rc, score, shape, alive: true, color, g: c0.g });
        for (const kk of rc) byCell.get(kk).push(ci);
      }
    }
  }
  const cnt = new Map([...byCell].map(([k, l]) => [k, l.length]));
  const covered = new Set(), placed = [];
  const kill = ci => { const c = cands[ci]; if (!c.alive) return; c.alive = false; for (const kk of c.rc) cnt.set(kk, cnt.get(kk) - 1); };
  const order = [...cellSet.keys()];
  for (;;) {
    let best = null, bc = Infinity;
    for (const k of order) if (!covered.has(k)) { const n = cnt.get(k); if (n > 0 && n < bc) { bc = n; best = k; if (n === 1) break; } }
    if (best === null) break;
    let bi = -1;
    for (const ci of byCell.get(best)) if (cands[ci].alive && (bi < 0 || cands[ci].score > cands[bi].score)) bi = ci;
    const c = cands[bi];
    placed.push(c);
    for (const kk of c.rc) { covered.add(kk); for (const cj of byCell.get(kk)) kill(cj); }
  }
  // repair: re-cover the neighbourhood of each stranded cell exactly (small backtracking search)
  const owner = new Map();
  placed.forEach((c, pi) => { for (const kk of c.rc) owner.set(kk, pi); });
  for (const u of order) {
    if (covered.has(u)) continue;
    const ui = Math.floor(u / 1000), uk = u % 1000, f = info.get(u).f;
    const region = new Set([u]), removed = new Set();
    for (let di = -4; di <= 4; di++) for (let dk = -4; dk <= 4; dk++) {
      const kk = (ui + di) * 1000 + (uk + dk), pi = owner.get(kk);
      if (pi === undefined || removed.has(pi) || info.get(kk).f !== f) continue;
      removed.add(pi);
      for (const c of placed[pi].rc) region.add(c);
    }
    const usable = [...new Set([...region].flatMap(kk => byCell.get(kk)))].filter(ci => cands[ci].rc.every(kk => region.has(kk) && (!covered.has(kk) || removed.has(owner.get(kk)))));
    const byC = new Map([...region].map(kk => [kk, usable.filter(ci => cands[ci].rc.includes(kk)).sort((x, y) => cands[y].score - cands[x].score)]));
    const cov = new Set(), pick = [];
    let nodes = 0;
    const solve = () => {
      if (++nodes > 4000) return false;
      let best = null, bn = Infinity;
      for (const kk of region) if (!cov.has(kk)) { const n = byC.get(kk).filter(ci => cands[ci].rc.every(c => !cov.has(c))).length; if (n < bn) { bn = n; best = kk; } }
      if (best === null) return true;
      if (!bn) return false;
      for (const ci of byC.get(best)) {
        const c = cands[ci];
        if (c.rc.some(x => cov.has(x))) continue;
        for (const x of c.rc) cov.add(x);
        pick.push(ci);
        if (solve()) return true;
        pick.pop();
        for (const x of c.rc) cov.delete(x);
      }
      return false;
    };
    if (!solve()) continue;
    for (const pi of removed) placed[pi] = null;
    for (const ci of pick) { const pi = placed.length; placed.push(cands[ci]); for (const kk of cands[ci].rc) { covered.add(kk); owner.set(kk, pi); } }
  }
  for (const c of placed) if (c) addPart(c.shape, c.a, c.b, c.i, j, c.k, MATS[c.color], { g: c.g });
  return [...cellSet.keys()].filter(k => !covered.has(k)).map(k => cellSet.get(k));
}

/** Pack every level bottom-up; special parts go in first at their level. Large levels are cut
 *  into bays that shift every level. */
let hung = 0, specialFail = 0;
const specialsAt = new Map();
for (const s of SPECIALS) { if (!specialsAt.has(s.j)) specialsAt.set(s.j, []); specialsAt.get(s.j).push(s); }
function packAll() {
  for (let j = 0; j < NY; j++) {
    for (const s of specialsAt.get(j) || []) {
      try { addPart(s.shape, s.sx, s.sz, s.i, j, s.k, s.color, { rotation: s.rot, h: s.h, g: s.g }); }
      catch (e) { specialFail++; if (process.env.DEBUG_SPECIAL) console.log('special:', e.message); }
    }
    const cells = [];
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) { const m = vox[idx(i, k, j)]; if (m && m !== MAT.reserved && !occ[idx(i, k, j)]) cells.push([i, k]); }
    if (!cells.length) continue;
    let left = [];
    if (cells.length > 3000) {
      const TB = 48, off = (j * 8) % 48 + 6;     // seams on the rib grid (every pocket keeps a rib), moving each level
      const bays = new Map();
      for (const c of cells) { const t = Math.floor((c[0] + off) / TB) + ',' + Math.floor((c[1] + off) / TB); if (!bays.has(t)) bays.set(t, []); bays.get(t).push(c); }
      for (const bay of bays.values()) left.push(...packLevel(j, bay));
      if (left.length) left = packLevel(j, left);            // across bay seams
    } else left = packLevel(j, cells);
    for (let pass = 0; pass < 3 && left.length; pass++) { const n = left.length; left = packLevel(j, left); if (left.length === n) break; }
    // last resort: a plate hung under the part above (it is grounded through that part)
    if (left.length) {
      // (under a special part too: it goes in at the next level and takes the studs)
      const hangers = left.filter(([i, k]) => vox[idx(i, k, j + 1)] && (vox[idx(i, k, j + 1)] === MAT.reserved || !occ[idx(i, k, j + 1)]));
      for (const [i, k] of hangers) flags[idx(i, k, j)] |= FL_HANG;
      if (hangers.length) { const rest = packLevel(j, hangers); hung += hangers.length - rest.length; left = left.filter(c => !hangers.includes(c)).concat(rest); }
    }
    for (const [i, k] of left) { dropped.push({ i, k, j, m: MATS[vox[idx(i, k, j)]] }); vox[idx(i, k, j)] = 0; }
  }
}

if (process.env.DEBUG_Y) {
  const CH = { verm: 'v', plaster: 'p', bark: 'B', tile: 'T', reserved: 'R', core: '#', pillar: 'o', nuki: '-', floor: '.', shitomi: 's', eave: 'e', soil: ':', gravel: ',', paving: '=', moss: 'm', undergrowth: 'u', 'leaf-litter': 'l' };
  for (const y of process.env.DEBUG_Y.split(',').map(Number)) {
    console.log(`--- level ${y}`);
    for (let z = -46; z < 50; z++) {
      let line = '';
      for (let x = -84; x < 60; x++) { const m = get(x, z, y); line += !m ? ' ' : (CH[MATS[m]] || '?'); }
      console.log(String(z).padStart(4) + ' ' + line);
    }
  }
}

packAll();

/* ------------------------------------------------------------ report */
const notGrounded = parts.filter((p, i) => !grounded[i]).length;
console.log(`slopes ${slopeCount}, trees ${treeCount}, closure removed ${closureRemoved}`, JSON.stringify(closureBy));
console.log(`parts ${parts.length}, not grounded ${notGrounded}, dropped voxels ${dropped.length}, hung ${hung}, specials failed ${specialFail}`);
const dropBy = {}; for (const d of dropped) dropBy[d.m] = (dropBy[d.m] || 0) + 1;
if (process.env.DEBUG_DROP) for (const d of dropped) if (d.m === process.env.DEBUG_DROP) console.log('drop', d.m, d.i + X_OFF, d.j - YS, d.k + Z_OFF);
console.log('dropped by material:', JSON.stringify(dropBy));
const byShape = {}; for (const p of parts) byShape[p.shape] = (byShape[p.shape] || 0) + 1;
console.log('shapes:', JSON.stringify(byShape));
const byGroup = {}; for (const p of parts) byGroup[p.g] = (byGroup[p.g] || 0) + 1;
console.log('groups:', JSON.stringify(byGroup));
if (process.env.DEBUG_STATS) {
  const by = {};
  for (const p of parts) { if (p.g !== +process.env.DEBUG_STATS) continue; const k = (p.y - YS) + ' ' + p.shape; by[k] = (by[k] || 0) + 1; }
  console.log(Object.entries(by).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([k, v]) => k + ':' + v).join('  '));
  const col = {}; for (const p of parts) if (p.g === +process.env.DEBUG_STATS) col[p.color] = (col[p.color] || 0) + 1;
  console.log(JSON.stringify(col));
}
if (process.env.DEBUG_MAP) {
  // parts per 8 x 8 region (terrain only), to find the expensive ground
  const cnt = new Map();
  for (const p of parts) if (p.g === 0) { const key = Math.floor((p.x) / 8) + ',' + Math.floor(p.z / 8); cnt.set(key, (cnt.get(key) || 0) + 1); }
  for (let bz = 0; bz < NZ / 8; bz++) { let line = String(Z_OFF + bz * 8).padStart(4) + ' '; for (let bx = 0; bx < NX / 8; bx++) line += String(cnt.get(bx + ',' + bz) || 0).padStart(4); console.log(line); }
}

/* ================================================================== 15. output */
const COLORS = {
  'base':            { name: 'Base (土台)', hex: '#4a4640' },
  'soil':            { name: 'Soil (土)', hex: '#6a5846' },
  'earth':           { name: 'Earth Bank (土の斜面)', hex: '#75604a', roughness: 0.7 },
  'ishigaki':        { name: 'Stone Wall (石垣)', hex: '#6f6a61', roughness: 0.62 },
  'moss':            { name: 'Moss (苔)', hex: '#5f6f38', roughness: 0.75 },
  'undergrowth':     { name: 'Undergrowth (下草)', hex: '#4e5d2e', roughness: 0.75 },
  'leaf-litter':     { name: 'Fallen Leaves (落ち葉)', hex: '#6e4a31', roughness: 0.8 },
  'gravel':          { name: 'Gravel (砂利)', hex: '#a39a86', roughness: 0.72 },
  'paving':          { name: 'Stone Paving (石畳)', hex: '#8b867c', roughness: 0.62 },
  'step':            { name: 'Stone Steps (石段)', hex: '#7f7a71', roughness: 0.62 },
  'street':          { name: 'Kiyomizu-zaka (清水坂)', hex: '#8f8575', roughness: 0.66 },
  'path':            { name: 'Valley Path (谷の小径)', hex: '#94825f', roughness: 0.72 },
  'water':           { name: 'Water (音羽の清水)', hex: '#5f9fbf', opacity: 0.72, roughness: 0.1 },
  'fall':            { name: 'Falling Water (音羽の滝)', hex: '#dff1f8', opacity: 0.6, roughness: 0.08 },
  'spout':           { name: 'Stone Spout (樋)', hex: '#5d5a54' },
  'felt':            { name: 'Red Felt (緋毛氈の床几)', hex: '#c0312b' },
  'pillar':          { name: 'Keyaki Pillar (欅の柱)', hex: '#8a6b50', roughness: 0.62 },
  'nuki':            { name: 'Nuki Beam (貫)', hex: '#7c5f47', roughness: 0.62 },
  'joist':           { name: 'Joist (根太)', hex: '#6a5140' },
  'floor':           { name: 'Stage Boards (檜の床板)', hex: '#c6a174', roughness: 0.5 },
  'rail':            { name: 'Railing (高欄)', hex: '#7a5d45' },
  'rail-post':       { name: 'Railing Post (高欄の束)', hex: '#6e5340' },
  'stone':           { name: 'Foundation Stone (礎石)', hex: '#9d998f', roughness: 0.6 },
  'shitomi':         { name: 'Shitomi Lattice (蔀戸)', hex: '#5b4535', roughness: 0.6 },
  'nageshi':         { name: 'Nageshi (長押)', hex: '#9b7b5c' },
  'wood':            { name: 'Weathered Wood (素木)', hex: '#86694f', roughness: 0.6 },
  'beam':            { name: 'Beam (桁)', hex: '#6f5440' },
  'bracket':         { name: 'Bracket (組物)', hex: '#7a5d45' },
  'shadow':          { name: 'Interior Shadow (堂内)', hex: '#2a211b' },
  'core':            { name: 'Structure (構造体)', hex: '#6a5140' },
  'gold':            { name: 'Gilded Fittings (金具・金箔)', hex: '#d2a63c', roughness: 0.3, metalness: 0.5 },
  'eave':            { name: 'Rafters (垂木)', hex: '#a2825f' },
  'eave-edge':       { name: 'Rafter Ends (垂木の木口)', hex: '#d8c7a3' },
  'bark':            { name: 'Cypress-Bark Roof (檜皮葺)', hex: '#6f412d', roughness: 0.72 },
  'ridge':           { name: 'Ridge (箱棟)', hex: '#35312e', roughness: 0.5 },
  'gable-wood':      { name: 'Gable (妻飾り)', hex: '#5a4332' },
  'tile':            { name: 'Tiled Roof (本瓦葺)', hex: '#5b5f64', roughness: 0.5 },
  'tile-ridge':      { name: 'Tile Ridge (大棟)', hex: '#3f4246', roughness: 0.45 },
  'verm':            { name: 'Vermilion (丹塗り)', hex: '#d0492b', roughness: 0.48 },
  'verm-lattice':    { name: 'Vermilion Lattice (朱の格子)', hex: '#b73d25' },
  'bracket-verm':    { name: 'Vermilion Bracket (朱の組物)', hex: '#c4442a' },
  'door-verm':       { name: 'Vermilion Door (朱の板扉)', hex: '#a9361f' },
  'plaster':         { name: 'White Plaster (白壁)', hex: '#f1ece0' },
  'window':          { name: 'Green Lattice Window (連子窓)', hex: '#3d7a5b' },
  'tip':             { name: 'Yellow Rafter Ends (黄土の垂木先)', hex: '#e4b43c' },
  'nio':             { name: 'Nio (仁王像)', hex: '#4e2c22' },
  'plinth':          { name: 'Plinth (基壇)', hex: '#8e897f', roughness: 0.6 },
  'bell':            { name: 'Bronze Bell (梵鐘)', hex: '#3f4a40', roughness: 0.35, metalness: 0.45 },
  'sorin':           { name: 'Sorin (相輪)', hex: '#3b3935', roughness: 0.35, metalness: 0.45 },
  'kasagi':          { name: 'Kasagi (笠木)', hex: '#2c2a28' },
  'machiya-wood':    { name: 'Machiya Timber (町家の柱)', hex: '#4a3527' },
  'koshi':           { name: 'Koshi Lattice (格子)', hex: '#3b2a1f' },
  'noren':           { name: 'Noren (暖簾)', hex: '#2f4a6e' },
  'mushiko':         { name: 'Mushiko Window (虫籠窓)', hex: '#3a2f28' },
  'lantern-stone':   { name: 'Stone Lantern (石灯籠)', hex: '#aaa59b', roughness: 0.65 },
  'lantern-light':   { name: 'Lantern Light (火袋)', hex: '#f3e2b4' },
  'trunk':           { name: 'Tree Trunk (幹)', hex: '#4c3b2e' },
  'maple-red':       { name: 'Maple Crimson (紅葉)', hex: '#a82a24' },
  'maple-scarlet':   { name: 'Maple Scarlet (紅葉)', hex: '#cf3f2a' },
  'maple-orange':    { name: 'Maple Orange (紅葉)', hex: '#d4622a' },
  'maple-amber':     { name: 'Maple Amber (紅葉)', hex: '#e8893a' },
  'maple-yellow':    { name: 'Maple Yellow (黄葉)', hex: '#d9a833' },
  'maple-gold':      { name: 'Maple Gold (黄葉)', hex: '#ecc653' },
  'maple-green':     { name: 'Maple Green (青もみじ)', hex: '#5d8a3a' },
  'maple-lime':      { name: 'Maple Lime (青もみじ)', hex: '#80a74a' },
  'evergreen':       { name: 'Evergreen Oak (常緑樹)', hex: '#3b5a33' },
  'evergreen-light': { name: 'Evergreen Light', hex: '#4f7342' },
  'cedar':           { name: 'Cedar (杉)', hex: '#2c4632' },
  'cedar-light':     { name: 'Cedar Light', hex: '#3b5b3f' }
};
/* ------------------------------------------------------------ steps */
// Build groups in order; a group is split into bands by height (design plate levels).
const GROUPS = [
  { title: '土台と地形', splits: [4, 10, 16], desc: '1枚のプレートの土台に、音羽山の地形を積みます（1スタッド＝1.5m、1プレート＝0.6m）。西の清水坂から石段で仁王門の段へ、さらに石段で境内の台地へ。台地の南は崖になって錦雲渓の谷へ下り、谷には小径と小川、向かいの丘には子安塔が立ちます。中は本物のブロック作品と同じく空洞にし、2スタッド幅のリブで支えています。' },
  { title: '懸造（かけづくり）の柱', splits: [11, 18], desc: '本堂と奥の院を、崖に立てた欅の柱で支えます。柱は3スタッドおきの格子に並び、礎石の上に丸ブロックを積んで、7プレートごとに「貫（ぬき）」で縦横につなぎます。釘を使わずに組む懸造は、本堂の舞台を約13mの高さで支えています。' },
  { title: '本堂の床と舞台', splits: [], desc: '根太を渡して檜の床板を張ります。本堂の前に張り出すのが「清水の舞台」。約190㎡の舞台の三方と、本堂のまわりの縁に高欄をめぐらせます。' },
  { title: '本堂と翼廊', splits: [], desc: '本堂（国宝、1633年再建）は桁行9間・梁間7間。舞台に面した礼堂は蔀戸を吊り上げて開け放ち、ほかの三方は蔀戸で閉じます。奥の内々陣には本尊の十一面千手観音を納めた金色の厨子。舞台の左右には翼廊が張り出します。' },
  { title: '本堂の屋根', splits: [], desc: '檜皮葺の寄棟屋根を、軒先の緩いスロープから棟の急なスロープへと段ごとに葺いていきます。左右の翼廊は入母屋造で、南に破風を向けて大屋根に取りつきます。' },
  { title: '清水坂と仁王門', splits: [], desc: '清水坂の両側に、格子と暖簾の1階、白壁に虫籠窓の2階、瓦屋根の町家を並べます。坂の突き当たりの石段の上に立つのが朱塗りの楼門、仁王門。「赤門」とも呼ばれます。正面の両脇に仁王像、上層には縁と高欄をめぐらせ、檜皮葺の入母屋屋根をかけます。' },
  { title: '西門と鐘楼', splits: [], desc: '仁王門の段から石段を上った先に西門（八脚門・切妻造）。夕日が京都の街に沈むのを望む門です。北には朱塗りの鐘楼に梵鐘を吊ります。' },
  { title: '三重塔', splits: [], desc: '高さ31m、国内最大級の三重塔。朱塗りの柱に白壁と緑の連子窓、黄色い垂木先、本瓦葺の屋根を3重に重ね、頂上に相輪と宝珠を立てます。' },
  { title: '経堂と開山堂', splits: [], desc: '三重塔の東に経堂（本瓦葺・入母屋造）、その南に坂上田村麻呂夫妻を祀る開山堂（田村堂、檜皮葺）。どちらも朱塗りです。' },
  { title: '轟門と回廊', splits: [], desc: '本堂へ入る轟門（とどろきもん）と、本堂の西の縁へ続く屋根付きの回廊です。' },
  { title: '奥の院', splits: [], desc: '本堂の東、音羽の滝の真上に立つ奥の院。これも懸造の舞台をもち、ここから眺める本堂の舞台と紅葉が清水寺でいちばん有名な景色です。' },
  { title: '音羽の滝', splits: [], desc: '清水寺の名の由来となった音羽の滝。石の樋から3筋の清水が池に落ちます。滝の前には檜皮葺の屋根、茶店の緋毛氈の床几も置きます。' },
  { title: '子安塔', splits: [], desc: '谷の向かいの丘に立つ朱塗りの三重塔、子安塔（泰産寺）。安産の祈願所です。' },
  { title: '地主神社の鳥居と石灯籠', splits: [], desc: '本堂の北、地主神社の朱の鳥居。参道と音羽の滝には石灯籠を立てます。' },
  { title: '紅葉と木々', splits: [14, 18, 22, 27], desc: '崖と谷をイロハモミジの紅葉で埋めます。深紅、朱、橙、黄金色、まだ青いもみじ。音羽山の上には杉と常緑樹。秋の夜間拝観のころの清水寺の姿です。' }
];
const bandOf = (g, y) => GROUPS[g].splits.filter(s => y >= s).length;

const partOrder = parts.map((p, i) => i).sort((a, b) => parts[a].y - parts[b].y || a - b);
const blocks = partOrder.map((pi, n) => {
  const p = parts[pi];
  return { id: `block_${String(n + 1).padStart(5, '0')}`, shape: p.shape, width: p.width, depth: p.depth, height: p.height, x: p.x + X_OFF, y: p.y - YS, z: p.z + Z_OFF, rotation: p.rotation, color: p.color, step: p.g * 100 + bandOf(p.g, p.y - YS) };
});
const usedColors = new Set(blocks.map(b => b.color));
for (const c of usedColors) if (!COLORS[c]) throw new Error(`colour ${c} is not defined`);
const raw = {
  format: 'blockmade.model', version: 2,
  name: '清水寺', nameEn: 'Kiyomizu-dera',
  description: '',
  author: 'Claude', prompt: '超リアルな清水寺（5000〜15000ピース）', createdAt: '2026-09-24',
  colors: Object.fromEntries(Object.entries(COLORS).filter(([k]) => usedColors.has(k))),
  steps: [], blocks
};
let pruned = 0, moved = 0, dropStuck = 0;
for (let attempt = 0; ; attempt++) {
  let stuck = null;
  for (;;) {
    const chk = core.validateModel(core.normalizeModel(raw));
    const bad = new Set([...chk.supported.floating, ...chk.connected.groups.slice(1).flat(), ...chk.collisions.pairs.map(p => p[1])]);
    if (!bad.size) break;
    if (process.env.DEBUG_PRUNE) { const mm = core.normalizeModel(raw); const by = {}; for (const id of bad) { const b = mm.byId.get(id); const k = b.color + '@' + b.shape; by[k] = (by[k] || 0) + 1; if (process.env.DEBUG_PRUNE === '2') console.log('  pruned', b.color, b.shape, b.width + 'x' + b.depth, b.x, b.y, b.z, 'rot', b.rotation); } console.log('prune', chk.supported.floating.length, chk.connected.groups.length, chk.collisions.pairs.length, JSON.stringify(by)); }
    pruned += bad.size;
    raw.blocks = raw.blocks.filter(b => !bad.has(b.id));
  }
  // build order, by simulation (as in gen-tokyo-station.mjs): parts that stand on a chain down to
  // the base (DS) go bottom-up, parts hung under them (US) top-down, riders last; a part that would
  // go on too early (a neighbour would later be sandwiched) waits for the next step.
  {
    const m0 = core.normalizeModel(raw), chk = core.validateModel(m0), Bk = m0.blocks, N = Bk.length;
    const above = Bk.map(b => chk.above.get(b.id).map(id => m0.byId.get(id).index));
    const below = Bk.map(b => chk.below.get(b.id).map(id => m0.byId.get(id).index));
    const kind = new Uint8Array(N);
    const byY = Bk.map((b, i) => i).sort((p, q) => Bk[p].y - Bk[q].y);
    const ds = new Uint8Array(N), us = new Uint8Array(N);
    for (const i of byY) ds[i] = Bk[i].y === 0 || below[i].some(q => ds[q]) ? 1 : 0;
    for (const i of [...byY].reverse()) us[i] = !ds[i] && above[i].some(q => ds[q] || us[q]) ? 1 : 0;
    for (let i = 0; i < N; i++) kind[i] = ds[i] ? 0 : us[i] ? 1 : 2;
    const rankOf = i => kind[i] === 0 ? Bk[i].y : kind[i] === 1 ? 1e6 - Bk[i].y : 2e6 + Bk[i].y;
    const want = Bk.map(b => raw.blocks[b.index].step);
    const keys = [...new Set(want)].sort((p, q) => p - q);
    const at = new Array(N).fill(null);
    const pending = Bk.map((b, i) => i).sort((p, q) => want[p] - want[q]);
    const early = i => below[i].some(q => at[q] === null && kind[q] !== 1 && (Bk[q].y === 0 || below[q].length > 0)) || above[i].some(q => at[q] === null && kind[q] === 1);
    let ptr = 0, pool = [], extra = 0;
    for (let ki = 0; ptr < pending.length || pool.length; ki++) {
      if (ki >= keys.length) { keys.push(keys[keys.length - 1] + 1); if (++extra > 60) { stuck = pool.map(i => Bk[i].id); break; } }
      const key = keys[ki];
      while (ptr < pending.length && want[pending[ptr]] <= key) pool.push(pending[ptr++]);
      let members = new Set(pool);
      for (;;) {
        const order = [...members].sort((p, q) => rankOf(p) - rankOf(q) || p - q);
        const placedNow = [];
        let bad = null, progress = true;
        while (progress && !bad) {
          progress = false;
          for (const i of order) {
            if (at[i] !== null) continue;
            const pb = below[i].some(q => at[q] !== null), pa = above[i].some(q => at[q] !== null);
            if (!(Bk[i].y === 0 || pb || pa)) continue;
            if (early(i)) { bad = i; break; }
            at[i] = key; placedNow.push(i); progress = true;
          }
        }
        if (!bad) break;
        for (const i of placedNow) at[i] = null;
        members.delete(bad);
      }
      pool = pool.filter(i => at[i] === null);
    }
    if (!stuck) Bk.forEach((b, i) => { const rb = raw.blocks[b.index]; if (rb.step !== at[i]) moved++; rb.step = at[i]; rb._rank = rankOf(i); });
  }
  if (!stuck) break;
  if (attempt > 4 || stuck.length > 200) throw new Error(`build order: ${stuck.length} parts never fit`);
  if (process.env.DEBUG_PRUNE === '2') { const mm = core.normalizeModel(raw); for (const id of stuck) { const b = mm.byId.get(id); console.log('  stuck', b.color, b.shape, b.x, b.y, b.z); } }
  const st = new Set(stuck); dropStuck += st.size;
  raw.blocks = raw.blocks.filter(b => !st.has(b.id));
}
raw.blocks.sort((a, b) => a.step - b.step || a._rank - b._rank);
raw.blocks.forEach(b => { delete b._rank; });
const usedSteps = [...new Set(raw.blocks.map(b => b.step))].sort((a, b) => a - b);
const stepNo = new Map(usedSteps.map((s, i) => [s, i + 1]));
raw.steps = usedSteps.map(s => {
  const G = GROUPS[Math.floor(s / 100)], part = s % 100, nb = G.splits.length + 1;
  const t = part < nb && nb > 1 ? `${G.title}（${part + 1}/${nb}）` : part >= nb ? `${G.title}（仕上げ）` : G.title;
  return { step: stepNo.get(s), title: t, description: G.desc };
});
raw.blocks.forEach(b => { b.step = stepNo.get(b.step); });
raw.blocks.forEach((b, n) => { b.id = `block_${String(n + 1).padStart(5, '0')}`; });
const m = core.normalizeModel(raw);
const fin = core.validateModel(m);
const bx = m.bounds;
raw.description = `京都・音羽山の清水寺を、紅葉の盛りの姿で1スタッド＝1.5m・1プレート＝0.6mに再現。崖に立てた欅の柱を貫で格子に組む懸造の上に「清水の舞台」と本堂、檜皮葺の大屋根を軒先の緩いスロープから棟の急なスロープへと葺き、入母屋の翼廊を添えました。清水坂の石段から朱塗りの仁王門・西門・鐘楼、高さ31mの三重塔、経堂と開山堂、轟門と回廊、奥の院の舞台、3筋の音羽の滝、谷向かいの子安塔、地主神社の鳥居まで。崖と錦雲渓の谷はイロハモミジの紅葉で埋めています。${bx.maxX - bx.minX}×${bx.maxZ - bx.minZ}スタッド・高さ${m.heightPlates}プレート・${m.blocks.length}パーツ。`;
writeFileSync(join(root, 'models/kiyomizu-dera.json'), core.modelToJSON(core.normalizeModel(raw)));
console.log(`wrote ${m.blocks.length} parts (pruned ${pruned}, dropped ${dropStuck} unorderable, moved ${moved}), ${raw.steps.length} steps, valid: ${fin.allOk}` + (fin.allOk ? '' : ' ' + core.describeIssues(m, fin, 10).join(' | ')));
