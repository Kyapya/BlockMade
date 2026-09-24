// Generates models/tokyo-station.json — the Marunouchi building of Tokyo Station, restored (2012).
//   node tools/gen-tokyo-station.mjs          (then: node tools/validate.mjs && node tools/build.mjs)
//   DEBUG_Y=4,28 node tools/gen-tokyo-station.mjs   prints plan-view maps of those plate levels
//
// Scale: 1 stud = 2 m, 1 plate = 0.8 m (one brick course = 2.4 m). The 335 m long building is
// 168 studs long; the domes rise to about 46 m (57 plates) with their finials.
// Model frame: +Z = west (the Marunouchi side, facing the Imperial Palace), +X = south.
//
// Pipeline
//   1. site     — voxels (stud × stud × plate) for the base, the Marunouchi Station Plaza,
//                 Gyoko-dori, the roads and taxi pools, the tracks, platforms and trains.
//   2. building — every block (wings, pavilions, the central pavilion and the two octagonal
//                 domes) is a volume: two-stud walls with the facade rhythm (red brick, white
//                 stone bands, windows set back one stud), a cornice, and a hipped roof built in
//                 courses of three plates. The dome roofs are cut from an ellipse.
//   3. slopes   — wherever a roof column steps down by one brick course to open air, the top
//                 course becomes a real slope part (runs of 4 / 2 / 1 wide).
//   4. pack     — each plate level is covered with real parts, bottom-up, most constrained cell
//                 first: bricks where three levels match, tiles on exposed tops, plates elsewhere;
//                 every part clips onto a stud below (slab plates may hang from the layer above).
//                 Special parts (slopes, arches, round bricks, cones) go in at their level first.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = require(join(root, 'js/model-core.js'));
const { PARTS } = core;

/* ------------------------------------------------------------------ grid */
const X_OFF = -92, Z_OFF = -52;          // grid index 0 -> stud -92 / -52
const NX = 184, NZ = 112, NY = 61;
const YS = 1;                            // design level 0 sits on a second base layer (real y = 1)
const I = x => x - X_OFF, K = z => z - Z_OFF;

/* ------------------------------------------------------------------ voxels */
const MATS = [null];
const MAT = {};
const mat = k => { if (!(k in MAT)) { MAT[k] = MATS.length; MATS.push(k); } return MAT[k]; };
mat('reserved');
const vox = new Uint8Array(NX * NZ * NY);
const flags = new Uint8Array(NX * NZ * NY);       // 1 = hang: a plate here may hang from the layer above
const FL_HANG = 1;
const idx = (i, k, j) => (j * NZ + k) * NX + i;
const inGrid = (i, k, j) => i >= 0 && i < NX && k >= 0 && k < NZ && j >= 0 && j < NY;
const gv = (i, k, j) => inGrid(i, k, j) ? vox[idx(i, k, j)] : 0;
const sv = (i, k, j, m, f = 0) => { if (inGrid(i, k, j)) { vox[idx(i, k, j)] = typeof m === 'string' ? mat(m) : m; flags[idx(i, k, j)] = f; } };
// stud-coordinate helpers used by the design code
// (design levels: y = 0 is the upper base layer; the lower one is laid directly at real y = 0)
const get = (x, z, y) => gv(I(x), K(z), y + YS);
const put = (x, z, y, m, f = 0) => sv(I(x), K(z), y + YS, m, f);
const clr = (x, z, y) => { const j = y + YS; if (inGrid(I(x), K(z), j)) { vox[idx(I(x), K(z), j)] = 0; flags[idx(I(x), K(z), j)] = 0; } };
const column = (x, z, y0, y1, m, f = 0) => { for (let y = y0; y < y1; y++) put(x, z, y, m, f); };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const X0 = X_OFF, X1 = X_OFF + NX, Z0 = Z_OFF, Z1 = Z_OFF + NZ;

/* Special parts: placed as they are (slopes, arches, round bricks, cones). Their voxels are
   'reserved' so the packer leaves them alone and the neighbours count them as filled. */
const SPECIALS = [];
const reserveCell = (x, z, y0, y1) => { for (let y = y0; y < y1; y++) put(x, z, y, 'reserved'); };
function special(shape, x, z, y, color, { sx = 1, sz = 1, rot = null, h = null, reserve = true } = {}) {
  const hh = h ?? PARTS[shape].heights[0];
  if (reserve) for (let a = 0; a < sx; a++) for (let b = 0; b < sz; b++) reserveCell(x + a, z + b, y, y + hh);
  SPECIALS.push({ shape, sx, sz, i: I(x), k: K(z), j: y + YS, color, rot, h: hh });
}

/* ================================================================== 1. site */
// Plan (studs). The building's west facade (wings) is the row z = -1; the plaza lies at z >= 0.
const Z_TRACKS = -18;                    // tracks and platforms: z < -18
const ROAD = { z0: 36, z1: 44 };         // the north-south street in front of the plaza
const PLAZA = { x0: -32, x1: 32 };       // pedestrian plaza between the two traffic plazas
const LAWN = { x0: 7, x1: 27, z0: 10, z1: 32 };
const MALL = { x0: -9, x1: 9 };          // Gyoko-dori: the central promenade
const GROAD = { x0: 9, x1: 25 };         // Gyoko-dori carriageways (mirrored)
const mir = x => -1 - x;                 // mirror a stud column about the axis x = 0
const ax = x => (x < 0 ? mir(x) : x);    // distance class from the axis (0, 1, 2, ... on both sides)

// tracks, from the building eastwards: [train rows], platforms, gaps
const TRACKS = [
  { z: -21, line: 'chuo' },              // train rows z and z+1
  { z: -29, line: null },
  { z: -33, line: 'yamanote' },
  { z: -41, line: 'keihin' },
  { z: -45, line: 'tokaido' }
];
const PLATFORMS = [{ z0: -27, z1: -21 }, { z0: -39, z1: -33 }, { z0: -51, z1: -45 }];
const PLAT_X = { x0: -80, x1: 80 };
const inPlatform = (x, z) => PLATFORMS.find(p => z >= p.z0 && z < p.z1 && x >= PLAT_X.x0 && x < PLAT_X.x1);
const trainRow = z => TRACKS.find(t => z === t.z || z === t.z + 1);

function surface(x, z) {
  const a = ax(x);
  if (z < Z_TRACKS) return trainRow(z) ? 'rail' : 'ballast';
  if (z < -10) return 'service';
  if (z < 6) return a >= 88 ? 'sidewalk' : 'sidewalk';
  if (z >= ROAD.z0 && z < ROAD.z1) {
    if (a < 8) return x % 2 === 0 ? 'marking' : 'asphalt';                 // zebra crossing to Gyoko-dori
    if (a >= 26 && a < 32) return x % 2 === 0 ? 'marking' : 'asphalt';     // crossings at the plaza corners
    if (z === 40) return 'marking';                                        // centre line
    if ((z === 38 || z === 42) && ((x + 400) % 6) < 3) return 'marking';    // lane lines
    return 'asphalt';
  }
  if (z >= ROAD.z1) {
    if (x >= MALL.x0 && x < MALL.x1) return a === 8 ? 'curb' : 'plaza';
    if (a >= GROAD.x0 && a < GROAD.x1) {
      if (a === 17 && (z % 6) < 3) return 'marking';
      return 'asphalt';
    }
    if (a < 31 || z < 48) return 'sidewalk';
    return a === 31 || z === 48 || a === 91 ? 'hedge' : 'lawn';
  }
  // 6 <= z < 36
  if (x >= PLAZA.x0 && x < PLAZA.x1) {
    if (a >= LAWN.x0 && a < LAWN.x1 && z >= LAWN.z0 && z < LAWN.z1) {
      const edge = a === LAWN.x0 || a === LAWN.x1 - 1 || z === LAWN.z0 || z === LAWN.z1 - 1;
      return edge ? 'curb' : 'lawn';
    }
    if (a === 31) return 'curb';
    return 'plaza';
  }
  if (a >= 88) return 'sidewalk';
  // traffic plazas north and south: bus and taxi pools around a central island
  if (z >= 18 && z < 23 && a >= 40 && a < 80) return z === 18 || z === 22 || a === 40 || a === 79 ? 'curb' : 'island';
  if (z === 6) return 'curb';
  if ((z === 12 || z === 28) && ((a + 400) % 6) < 3) return 'marking';
  if (a === 33 && z > 6) return 'marking';
  return 'asphalt';
}

for (let x = X0; x < X1; x++) for (let z = Z0; z < Z1; z++) {
  sv(I(x), K(z), 0, 'base');           // two plate layers of base: the upper one bridges the seams
  put(x, z, 0, 'base');
  const s = surface(x, z);
  if (s === 'rail') { put(x, z, 1, 'ballast'); put(x, z, 2, 'rail'); }
  else if (s === 'hedge') { put(x, z, 1, 'hedge'); put(x, z, 2, 'hedge'); }
  else put(x, z, 1, s);
}

// platforms: two plates of body, a tiled top with white edges and yellow tactile strips
for (const p of PLATFORMS) for (let x = PLAT_X.x0; x < PLAT_X.x1; x++) for (let z = p.z0; z < p.z1; z++) {
  column(x, z, 1, 3, 'platform-core');
  const e = Math.min(z - p.z0, p.z1 - 1 - z);
  const endE = Math.min(x - PLAT_X.x0, PLAT_X.x1 - 1 - x);
  put(x, z, 3, e === 0 || endE === 0 ? 'platform-edge' : e === 1 && endE > 0 ? 'tactile' : 'platform');
}

/* ------------------------------------------------------------ trains */
// Stainless commuter cars (E233 / E235): 10 studs = 20 m per car, 2 studs wide, on bogies.
const LINES = {
  chuo:     { stripe: 'chuo-orange', top: 'chuo-orange', cars: 6, x0: -66, dir: 1 },
  yamanote: { stripe: 'yamanote-green', top: 'yamanote-green', cars: 7, x0: -58, dir: -1, doors: 'yamanote-green' },
  keihin:   { stripe: 'keihin-blue', top: 'keihin-blue', cars: 5, x0: -30, dir: 1 },
  tokaido:  { stripe: 'shonan-orange', top: 'shonan-green', cars: 8, x0: -84, dir: -1 }
};
const TRAINS = [];
for (const t of TRACKS) {
  if (!t.line) continue;
  const L = LINES[t.line], len = L.cars * 10;
  TRAINS.push({ ...t, ...L, len });
  for (let a = 0; a < len; a++) for (let b = 0; b < 2; b++) {
    const x = L.x0 + a, z = t.z + b, ca = a % 10;
    const head = a === 0 || a === len - 1;
    if (ca === 1 || ca === 2 || ca === 7 || ca === 8) put(x, z, 2, 'bogie');
    else clr(x, z, 2);                               // no rail tiles under the car body
    const pillar = ca % 3 === 0;
    const door = L.doors && (ca === 2 || ca === 5 || ca === 8);
    put(x, z, 3, 'steel-body');
    put(x, z, 4, head ? 'train-front' : L.stripe);
    for (const y of [5, 6]) put(x, z, y, head ? 'train-front' : door ? L.doors : pillar ? 'steel-body' : 'train-window');
    put(x, z, 7, head ? 'train-front' : L.top);
    put(x, z, 8, 'train-roof');
  }
  // pantograph wells and air conditioners: a darker hump on every other car
  for (let c = 0; c < L.cars; c++) for (const b of [0, 1]) for (const a of [4, 5]) put(L.x0 + c * 10 + a, t.z + b, 9, 'train-ac');
}

/* ------------------------------------------------------------ platform canopies */
// steel posts every 8 studs down the middle of each platform; a 6 x 8 plate on each post carries
// the canopy, which is roofed in tiles
for (const p of PLATFORMS) {
  const zc = p.z0 + 3;
  for (let x = PLAT_X.x0; x < PLAT_X.x1; x += 8) {
    const px = x + 3;
    for (let n = 0; n < 3; n++) special('round-brick', px, zc, 3 + 3 * n, 'steel-post');
    special('plate', x, p.z0 + 1, 12, 'canopy-under', { sx: 8, sz: 4 });
  }
  for (let x = PLAT_X.x0; x < PLAT_X.x1; x++) for (let z = p.z0 + 1; z < p.z1 - 1; z++) {
    const edge = z === p.z0 + 1 || z === p.z1 - 2;
    put(x, z, 13, edge ? 'canopy-edge' : 'canopy');
  }
}

/* ================================================================== 2. building */
// Vertical rhythm (plates above the base plate, y = 0):
//   1-2 granite plinth, 3 stone cap | 1F windows 4-8, band 9 | 2F sills 11, windows 12-15, band 16 |
//   3F sills 18, windows 19-21, band 22 | frieze 23 (wings: cornice 24) |
//   tall blocks: attic 23-26 with small windows 24-25, cornice 27
const WIN = 'window';
function wallMat(y, tall, win, quoin) {
  if (y <= 2) return 'plinth';
  if (y === 3) return 'stone';
  if (win) {
    if ((y >= 4 && y <= 8) || (y >= 12 && y <= 15) || (y >= 19 && y <= 21)) return WIN;
    if (tall && (y === 24 || y === 25)) return WIN;
    if (y === 11 || y === 18) return 'stone';
  }
  if (y === 9 || y === 16 || y === 22) return 'stone';
  if (quoin && y >= 4 && (y - 4) % 4 < 2) return 'stone';
  return 'brick';
}
/** Window columns along a face: pairs about the face centre, a two-stud rhythm, margins at the ends. */
function winCol(t, t0, t1, margin = 1.5) {
  const c = (t0 + t1) / 2, w = Math.abs(t + 0.5 - c), half = (t1 - t0) / 2;
  if (w > half - margin) return false;
  return (t1 - t0) % 2 === 0 ? (w - 1.5) % 2 === 0 : w % 2 === 1;
}

const VOLS = [];
// rect volumes: [x0, x1) × [z0, z1). yc = cornice level; roof courses start at yc + 1.
function rectVol(kind, x0, x1, z0, z1, o) {
  VOLS.push({ kind, shape: 'rect', x0, x1, z0, z1, ...o });
  if (x0 >= 0) VOLS.push({ kind, shape: 'rect', x0: -x1, x1: -x0, z0, z1, ...o, openW: o.openE, openE: o.openW });
}
const WING = { yc: 24, courses: 3, tall: false };
const TALL = { yc: 27, courses: 4, tall: true };
rectVol('center', -13, 13, -12, 2, { ...TALL, label: '中央部' });
rectVol('wing', 13, 27, -10, 0, { ...WING, openW: true, openE: true });
rectVol('pavilion', 27, 37, -11, 1, { ...TALL });
rectVol('wing', 37, 51, -10, 0, { ...WING, openW: true, openE: true });
rectVol('wing', 67, 74, -10, 0, { ...WING, openW: true, openE: true });
rectVol('pavilion', 74, 84, -11, 1, { ...TALL });
// the domes: regular octagons, 32 m across, centred on stud grid lines
const DOME_R = 8, DOME_ZC = -5;
for (const xc of [59, -59]) VOLS.push({ kind: 'dome', shape: 'oct', xc, zc: DOME_ZC, r: DOME_R, yc: 27, tall: true, label: xc > 0 ? '南ドーム' : '北ドーム' });

const octD = (V, x, z) => { const dx = Math.abs(x + 0.5 - V.xc), dz = Math.abs(z + 0.5 - V.zc); return Math.max(dx, dz, (dx + dz) / Math.SQRT2); };
function inFoot(V, x, z) {
  if (V.shape === 'rect') return x >= V.x0 && x < V.x1 && z >= V.z0 && z < V.z1;
  return octD(V, x, z) < V.r;
}
function bbox(V) {
  if (V.shape === 'rect') return [V.x0, V.x1, V.z0, V.z1];
  return [V.xc - V.r - 1, V.xc + V.r + 1, V.zc - V.r - 1, V.zc + V.r + 1];
}
const solidAt = (x, z, y) => VOLS.some(V => y < V.yc && inFoot(V, x, z));
const inAnyFoot = (x, z, except) => VOLS.some(V => V !== except && inFoot(V, x, z));
const PORCH = { x0: -9, x1: 9, z0: 2, z1: 9, top: 13 };
const inPorch = (x, z) => x >= PORCH.x0 && x < PORCH.x1 && z >= PORCH.z0 && z < PORCH.z1;

// ring index of each footprint cell (0 = outer wall face, 1 = inner wall face, 2 = inside)
for (const V of VOLS) {
  const [bx0, bx1, bz0, bz1] = bbox(V);
  V.ring = new Map();
  for (let x = bx0; x < bx1; x++) for (let z = bz0; z < bz1; z++) {
    if (!inFoot(V, x, z)) continue;
    let r = 2;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const d = Math.abs(dx) + Math.abs(dz);
      if (d === 0 || d > 2) continue;
      if (!inFoot(V, x + dx, z + dz)) r = Math.min(r, d - 1);
    }
    V.ring.set(x + ',' + z, r);
  }
}
/** Facade info for an outer-ring cell: outward normals and whether it is a window column / quoin. */
function faceInfo(V, x, z) {
  const outs = N4.filter(([dx, dz]) => !inFoot(V, x + dx, z + dz));
  let win = false, quoin = false;
  if (V.shape === 'rect') {
    const nz = outs.some(([dx]) => dx === 0), nx = outs.some(([dx]) => dx !== 0);
    quoin = nz && nx && V.kind !== 'wing';
    if (nz && !nx) win = winCol(x, V.x0, V.x1);
    if (nx && !nz) win = winCol(z, V.z0, V.z1);
  } else {
    const dx = x + 0.5 - V.xc, dz = z + 0.5 - V.zc, adx = Math.abs(dx), adz = Math.abs(dz), dg = (adx + adz) / Math.SQRT2;
    if (adz >= adx && adz >= dg) win = Math.abs(dx) === 1.5;
    else if (adx >= adz && adx >= dg) win = Math.abs(dz) === 1.5;
  }
  return { outs, win, quoin };
}

// walls, interior floors
for (const V of VOLS) {
  for (const [key, r] of V.ring) {
    const [x, z] = key.split(',').map(Number);
    if (r === 2) { if (!inPorch(x, z)) put(x, z, 1, 'floor'); continue; }
    for (let y = 1; y < V.yc; y++) {
      let m;
      if (r === 0) {
        const f = faceInfo(V, x, z);
        const exposed = f.outs.some(([dx, dz]) => !solidAt(x + dx, z + dz, y));
        m = exposed ? wallMat(y, V.tall, f.win, f.quoin) : wallMat(y, V.tall, false, false);
        if (m === WIN) m = null;                                          // the opening
      } else {
        // inner face: glass behind an exposed window opening, else the wall material
        let glass = false;
        for (const [dx, dz] of N4) {
          const x2 = x + dx, z2 = z + dz;
          if (V.ring.get(x2 + ',' + z2) !== 0) continue;
          const f = faceInfo(V, x2, z2);
          if (!f.win || !f.outs.some(([ex, ez]) => !solidAt(x2 + ex, z2 + ez, y))) continue;
          if (wallMat(y, V.tall, true, false) === WIN) glass = true;
        }
        m = glass ? 'window' : wallMat(y, V.tall, false, false);
      }
      if (m) put(x, z, y, m);
    }
  }
}

// cornice: the wall top plus a one-stud overhang (not where it would run into another block)
function overhangCells(V) {
  const out = [];
  const [bx0, bx1, bz0, bz1] = bbox(V);
  for (let x = bx0 - 1; x < bx1 + 1; x++) for (let z = bz0 - 1; z < bz1 + 1; z++) {
    if (inFoot(V, x, z)) continue;
    let near = false;
    if (V.shape === 'rect') {
      const cx = Math.max(V.x0, Math.min(V.x1 - 1, x)), cz = Math.max(V.z0, Math.min(V.z1 - 1, z));
      near = Math.abs(cx - x) <= 1 && Math.abs(cz - z) <= 1;
      if ((V.openW && x < V.x0) || (V.openE && x >= V.x1)) near = false;
    } else near = octD(V, x, z) < V.r + 1;
    if (near && !inAnyFoot(x, z, V)) out.push([x, z]);
  }
  return out;
}
for (const V of VOLS) {
  V.over = overhangCells(V);
  for (const [key, r] of V.ring) {
    const [x, z] = key.split(',').map(Number);
    if (r < 2) put(x, z, V.yc, 'cornice');
    else if (V.shape === 'oct') put(x, z, V.yc, 'core', FL_HANG);   // slab under the dome
  }
  for (const [x, z] of V.over) put(x, z, V.yc, 'cornice');
}

/* ------------------------------------------------------------ roofs */
// Hipped roofs in courses of three plates: a column at inset c (from the hipped edges, the
// overhang being inset 0) holds the front of course c and the back of course c - 1; past the
// last course, a two-plate flat top (a hanging slab plate and the finish).
function roofRect(V) {
  const ox0 = V.openW ? 0 : 1, ox1 = V.openE ? 0 : 1;
  return { x0: V.x0 - ox0, x1: V.x1 + ox1, z0: V.z0 - 1, z1: V.z1 + 1 };
}
for (const V of VOLS) {
  if (V.shape !== 'rect') continue;
  const R = roofRect(V), yb = V.yc + 1, n = V.courses;
  const over = new Set(V.over.map(([x, z]) => x + ',' + z));
  for (let x = R.x0; x < R.x1; x++) for (let z = R.z0; z < R.z1; z++) {
    if (!inFoot(V, x, z) && !over.has(x + ',' + z)) continue;
    const ins = [z - R.z0, R.z1 - 1 - z];
    if (!V.openW) ins.push(x - R.x0);
    if (!V.openE) ins.push(R.x1 - 1 - x);
    const c = Math.min(...ins);
    const fillRange = (a, b, m, f = 0) => { for (let y = a; y < b; y++) put(x, z, y, m, f); };
    if (c < n) {
      if (c >= 1) fillRange(yb + 3 * (c - 1), yb + 3 * c, 'slate');
      fillRange(yb + 3 * c, yb + 3 * c + 3, 'slate');
    } else {
      if (c === n) fillRange(yb + 3 * (n - 1), yb + 3 * n, 'slate');
      put(x, z, yb + 3 * n, 'roof-core', FL_HANG);
      put(x, z, yb + 3 * n + 1, V.kind === 'wing' ? 'slate' : 'roof-lead');
    }
  }
}

// dormer windows on the second course of the wing roofs, every four studs above the windows
for (const V of VOLS) {
  if (V.kind !== 'wing') continue;
  const R = roofRect(V), y = V.yc + 4;
  for (let x = V.x0; x < V.x1; x++) {
    const w = Math.abs(x + 0.5 - (V.x0 + V.x1) / 2);
    if (!winCol(x, V.x0, V.x1) || ((V.x1 - V.x0) % 2 === 0 ? (w - 1.5) % 4 : (w - 1) % 4) !== 0) continue;
    for (const z of [R.z1 - 2, R.z0 + 1]) {
      put(x, z, y, 'dormer'); put(x, z, y + 1, 'window'); put(x, z, y + 2, 'window'); put(x, z, y + 3, 'dormer');
    }
  }
}

/* ------------------------------------------------------------ domes */
// Dome roof: an ellipse from the cornice overhang (radius 9 studs) up to the lantern.
const DOME_Y0 = 28, DOME_H = 17;
const domeR = y => (DOME_R + 1) * Math.sqrt(Math.max(0, 1 - ((y - DOME_Y0 + 0.5) / DOME_H) ** 2));
const DOME_TOP = 44;                                 // first level of the lantern
for (const V of VOLS) {
  if (V.shape !== 'oct') continue;
  const [bx0, bx1, bz0, bz1] = bbox(V);
  for (let y = DOME_Y0; y < DOME_TOP; y++) {
    const r = domeR(y), rNext = y + 1 < DOME_TOP ? domeR(y + 1) : 2.6;
    for (let x = bx0 - 1; x < bx1 + 1; x++) for (let z = bz0 - 1; z < bz1 + 1; z++) {
      const d = octD(V, x, z);
      if (d >= r) continue;
      if (d >= DOME_R && inAnyFoot(x, z, V)) continue;
      // a band of copper at the foot, dormers on the four axes and the four diagonals
      const dx = Math.abs(x + 0.5 - V.xc), dz = Math.abs(z + 0.5 - V.zc);
      const surf = d >= rNext - 0.01 || d >= r - 1;
      let m = 'dome';
      if (surf) {
        if (y === DOME_Y0) m = 'copper';
        if ((y === 33 || y === 34) && (dx === 0.5 || dz === 0.5) && d >= r - 1) m = 'dormer';
        if (y === 35 && (dx === 0.5 || dz === 0.5) && d >= r - 1) m = 'copper';
      }
      put(x, z, y, surf ? m : 'dome-core');
    }
  }
  // lantern: a small octagon with windows, a copper cap, a finial of a round brick and a cone
  const cx = V.xc, cz = V.zc;
  const oct = (r, fn) => { for (let x = cx - 4; x < cx + 4; x++) for (let z = cz - 4; z < cz + 4; z++) { const d = octD(V, x, z); if (d < r) fn(x, z, d); } };
  for (let y = DOME_TOP; y < DOME_TOP + 4; y++) oct(2.6, (x, z, d) => {
    const dx = Math.abs(x + 0.5 - cx), dz = Math.abs(z + 0.5 - cz);
    const face = d >= 1.6 && (dx === 0.5 || dz === 0.5);
    put(x, z, y, face && (y === DOME_TOP + 1 || y === DOME_TOP + 2) ? 'lantern' : 'copper');
  });
  oct(3.0, (x, z) => put(x, z, DOME_TOP + 4, 'copper'));
  oct(2.2, (x, z) => put(x, z, DOME_TOP + 5, 'copper'));
  oct(1.6, (x, z) => put(x, z, DOME_TOP + 6, 'copper'));
  special('round-brick', cx - 1, cz - 1, DOME_TOP + 7, 'gold', { sx: 2, sz: 2 });
  special('cone', cx - 1, cz - 1, DOME_TOP + 10, 'gold', { sx: 2, sz: 2 });
}

/* ------------------------------------------------------------ arches: dome entrances and the porch */
// arch 1 x 6 x 3 (nine plates): legs on the plinth, the opening beneath is cleared
function arch(x, z, y, alongX) {
  const cells = [];
  for (let s = 0; s < 6; s++) cells.push(alongX ? [x + s, z] : [x, z + s]);
  for (const [cx, cz] of cells) for (let yy = y; yy < y + 9; yy++) clr(cx, cz, yy);
  for (const [cx, cz] of cells.slice(1, 5)) for (let yy = 1; yy < y; yy++) clr(cx, cz, yy);
  for (const [cx, cz] of cells.slice(1, 5)) put(cx, cz, 1, 'floor');
  for (const [cx, cz] of [cells[0], cells[5]]) { column(cx, cz, 1, 3, 'plinth'); put(cx, cz, 3, 'stone'); }
  for (const [cx, cz] of cells) reserveCell(cx, cz, y + 6, y + 9);
  for (const [cx, cz] of [cells[0], cells[5]]) reserveCell(cx, cz, y, y + 6);
  special('arch', x, z, y, 'stone', { sx: alongX ? 6 : 1, sz: alongX ? 1 : 6, rot: alongX ? 90 : 0, h: 9, reserve: false });
}
for (const V of VOLS) {
  if (V.shape !== 'oct') continue;
  const zf = V.zc + V.r - 1;                    // the front row of the octagon
  arch(V.xc - 3, zf, 4, true);
  arch(V.xc - 3, zf - 1, 4, true);
}
// the central porch (the imperial entrance): three arches in front, one on each side,
// a stone roof with a balustrade
for (const x0 of [-9, -3, 3]) arch(x0, PORCH.z1 - 1, 4, true);
for (const x of [PORCH.x0, PORCH.x1 - 1]) arch(x, PORCH.z0, 4, false);
for (let x = PORCH.x0; x < PORCH.x1; x++) for (let z = PORCH.z0; z < PORCH.z1; z++) {
  const edge = x === PORCH.x0 || x === PORCH.x1 - 1 || z === PORCH.z1 - 1;
  if (!edge) { put(x, z, 1, 'floor'); }
  put(x, z, PORCH.top, 'cornice', edge ? 0 : FL_HANG);
  if (edge) {
    const t = z === PORCH.z1 - 1 ? x : z;
    if (t % 2 === 0 || x === PORCH.x0 || x === PORCH.x1 - 1 && z === PORCH.z1 - 1) put(x, z, PORCH.top + 1, 'stone');
    put(x, z, PORCH.top + 2, 'cornice');
  } else put(x, z, PORCH.top + 1, 'roof-lead');
}
// corner posts of the balustrade need their rail supported at both ends
for (const [x, z] of [[PORCH.x0, PORCH.z1 - 1], [PORCH.x1 - 1, PORCH.z1 - 1], [PORCH.x0, PORCH.z0], [PORCH.x1 - 1, PORCH.z0]]) put(x, z, PORCH.top + 1, 'stone');
// the entrance doors behind the porch
for (let x = -2; x < 2; x++) for (let y = 1; y < 9; y++) { clr(x, 1, y); put(x, 0, y, y < 9 ? 'door' : 'stone'); }
for (let x = -2; x < 2; x++) put(x, 1, 1, 'floor');

/* ------------------------------------------------------------ ornaments on the pavilion roofs */
// a low cresting of copper along the flat tops of the central pavilion and the pavilions
for (const V of VOLS) {
  if (V.shape !== 'rect' || V.kind === 'wing') continue;
  const R = roofRect(V), yt = V.yc + 1 + 3 * V.courses + 2;
  const zm = Math.floor((R.z0 + R.z1) / 2) - 1;
  for (let x = R.x0 + V.courses + 1; x < R.x1 - V.courses - 1; x++) for (const z of [zm, zm + 1]) put(x, z, yt, 'copper');
}

/* ------------------------------------------------------------ plaza: trees, lamps, cars */
// keyaki (zelkova) in the plaza, ginkgo along Gyoko-dori; a trunk of round bricks, a canopy of voxels
function tree(x, z, kind) {
  const R = kind === 'keyaki' ? [1, 2, 2.9, 3.3, 3.5, 3.5, 3.3, 2.9, 2.2, 1.2] : [1, 1.7, 2.3, 2.5, 2.5, 2.4, 2.2, 1.9, 1.6, 1.2, 1];
  for (let n = 0; n < 2; n++) special('round-brick', x, z, 1 + 3 * n, 'trunk');
  const cx = x + 1, cz = z + 1;
  R.forEach((r, n) => {
    const y = 7 + n;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const px = cx + dx, pz = cz + dz, ex = px + 0.5 - cx, ez = pz + 0.5 - cz;
      if (ex * ex + ez * ez > r * r + 1e-9) continue;
      const light = n >= R.length - 3;
      put(px, pz, y, kind + (light ? '-light' : ''));
    }
  });
}
const TREES = [];
for (const z of [9, 16, 23, 30]) for (const x of [-31, 29]) TREES.push([x, z, 'keyaki']);
for (const z of [10, 24]) for (const x of [-89, 87]) TREES.push([x, z, 'keyaki']);
for (const z of [47, 53]) for (const x of [-9, 7, -30, 28]) TREES.push([x, z, 'ginkgo']);
for (const x of [46, 59, 72]) for (const s of [1, -1]) TREES.push([s > 0 ? x : mir(x) - 1, 19, 'keyaki']);
for (const [x, z, kind] of TREES) tree(x, z, kind);

// street lamps: a black post, a milky globe and a cap
function lamp(x, z) {
  for (let n = 0; n < 2; n++) special('round-brick', x, z, 1 + 3 * n, 'lamp-post');
  special('round-brick', x, z, 7, 'lamp-globe');
  special('cone', x, z, 10, 'lamp-post');
}
for (let x = 18; x < 88; x += 10) for (const s of [1, -1]) { const lx = s > 0 ? x : mir(x); if (!inAnyFoot(lx, 4) && !inAnyFoot(lx, 3)) lamp(lx, 4); }
for (const z of [50, 56]) for (const x of [-10, 9]) lamp(x, z);

// taxis (JPN TAXI, deep indigo) waiting in the pools, city buses at the bus stops
function taxi(x, z) { for (const a of [0, 1]) { put(x + a, z, 1, 'taxi'); put(x + a, z, 2, a === 0 ? 'car-glass' : 'taxi'); } }
function bus(x, z) {
  for (let a = 0; a < 5; a++) for (const b of [0, 1]) {
    const px = x + a, pz = z + b;
    put(px, pz, 1, 'bus-under');
    put(px, pz, 2, 'bus-green');
    put(px, pz, 3, a === 0 ? 'bus-window' : 'bus-body');
    put(px, pz, 4, a === 4 ? 'bus-body' : 'bus-window');
    put(px, pz, 5, 'bus-body');
  }
}
for (const s of [1, -1]) {
  const X = x => (s > 0 ? x : mir(x) - 1);
  for (let x = 42; x < 78; x += 3) taxi(X(x), 16);
  for (let x = 46; x < 70; x += 3) taxi(X(x), 24);
  for (const x of [44, 58]) bus(s > 0 ? x : mir(x) - 4, 9);
  for (const x of [36, 50, 66]) taxi(X(x), 31);
}
for (const [x, z] of [[-40, 38], [-20, 41], [22, 38], [50, 41], [70, 38], [-70, 41], [30, 45], [-16, 52], [14, 49]]) {
  if (z >= ROAD.z1) { taxi(x, z); continue; }
  taxi(x, z);
}

/* ================================================================== 3. slopes */
// A roof column whose top course (three plates of roof) looks out over open air on one side and
// backs onto roof on the other becomes a slope: front = the column, back = the one behind it.
const SLOPE_OK = new Set(['slate', 'dome', 'copper'].map(mat));
const slopeFront = new Uint8Array(NX * NZ * NY);
let slopeCount = 0;
{
  const DIRS = [[0, 1, 0], [0, -1, 180], [1, 0, 90], [-1, 0, 270]];   // outward (di, dk), rotation
  const okRoof = (i, k, j) => SLOPE_OK.has(gv(i, k, j));
  for (const [di, dk, rot] of DIRS) {
    for (let j = 1; j + 3 < NY; j++) {
      const elig = new Set();
      for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
        if (!okRoof(i, k, j) || !okRoof(i, k, j + 1) || !okRoof(i, k, j + 2) || gv(i, k, j + 3)) continue;
        const bi = i - di, bk = k - dk;
        if (!okRoof(bi, bk, j) || !okRoof(bi, bk, j + 1) || !okRoof(bi, bk, j + 2)) continue;
        if (gv(i + di, k + dk, j) || gv(i + di, k + dk, j + 1) || gv(i + di, k + dk, j + 2)) continue;
        const under = (a, b) => gv(a, b, j - 1) && !slopeFront[idx(a, b, j - 1)];
        if (!under(i, k) && !under(bi, bk)) continue;
        elig.add(i * 1000 + k);
      }
      // runs along the eave: 4, 2 or 1 wide
      const done = new Set();
      for (const key of [...elig].sort((a, b) => a - b)) {
        if (done.has(key)) continue;
        const i = Math.floor(key / 1000), k = key % 1000;
        const ui = dk !== 0 ? 1 : 0, uk = dk !== 0 ? 0 : 1;              // along the eave
        let run = 0;
        while (run < 4 && elig.has((i + ui * run) * 1000 + (k + uk * run)) && !done.has((i + ui * run) * 1000 + (k + uk * run))) run++;
        const w = run >= 4 ? 4 : run >= 2 ? 2 : 1;
        const color = MATS[gv(i, k, j + 2)];
        for (let s = 0; s < w; s++) {
          const fi = i + ui * s, fk = k + uk * s;
          done.add(fi * 1000 + fk);
          for (let t = 0; t < 3; t++) { vox[idx(fi, fk, j + t)] = MAT.reserved; slopeFront[idx(fi, fk, j + t)] = 1; vox[idx(fi - di, fk - dk, j + t)] = MAT.reserved; }
        }
        // min corner of the part in grid cells
        const minI = Math.min(i, i - di, i + ui * (w - 1)), minK = Math.min(k, k - dk, k + uk * (w - 1));
        const sx = dk !== 0 ? w : 2, sz = dk !== 0 ? 2 : w;
        SPECIALS.push({ shape: 'slope', sx, sz, i: minI, k: minK, j, color, rot, h: 3 });
        slopeCount++;
      }
    }
  }
}

/* ================================================================== 4. packing */
const FAMILY = {
  'brick': 'wall', 'stone': 'wall', 'plinth': 'wall', 'cornice': 'wall', 'core': 'wall', 'door': 'wall',
  'slate': 'roof', 'roof-core': 'roof', 'roof-lead': 'roof', 'dome': 'roof', 'dome-core': 'roof', 'copper': 'roof', 'dormer': 'roof', 'lantern': 'roof',
  'keyaki': 'keyaki', 'keyaki-light': 'keyaki', 'ginkgo': 'ginkgo', 'ginkgo-light': 'ginkgo',
  'platform-core': 'platform', 'platform': 'platform', 'platform-edge': 'platform', 'tactile': 'platform',
  'steel-body': 'train', 'chuo-orange': 'train', 'yamanote-green': 'train', 'keihin-blue': 'train', 'shonan-orange': 'train', 'shonan-green': 'train',
  'train-window': 'train', 'train-front': 'train', 'train-roof': 'train', 'train-ac': 'train',
  'canopy': 'canopy', 'canopy-edge': 'canopy',
  'taxi': 'car', 'car-glass': 'car', 'bus-under': 'car', 'bus-green': 'car', 'bus-body': 'car', 'bus-window': 'car'
};
const famId = new Map();
const famOf = m => { const f = FAMILY[MATS[m]] || MATS[m]; if (!famId.has(f)) famId.set(f, famId.size + 1); return famId.get(f); };
// hidden or textured surfaces: plates (studs on top) are fine
const NO_TILE = new Set(['base', 'core', 'roof-core', 'dome-core', 'platform-core', 'ballast', 'lawn', 'hedge', 'keyaki', 'keyaki-light', 'ginkgo', 'ginkgo-light', 'bogie']);

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
    // a corner cell: a 2 x 2 plate can reach a supported cell diagonally
    for (const [di, dk] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const cells = [[i + di, k], [i, k + dk], [i + di, k + dk]];
      if (cells.every(([a, b]) => gv(a, b, j) && gv(a, b, j) !== MAT.reserved && famOf(gv(a, b, j)) === f) && cells.some(([a, b]) => direct(a, b, j))) return true;
    }
    for (const [di, dk] of N4) for (let t = 1; t < 8; t++) {
      const a = i + di * t, b = k + dk * t, m = gv(a, b, j);
      if (!m || m === MAT.reserved || famOf(m) !== f) break;
      if (direct(a, b, j)) return true;
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

function addPart(shape, sx, sz, i, j, k, color, { rotation = null, h = null } = {}) {
  const Pt = PARTS[shape];
  const height = h ?? Pt.heights[0];
  let width, depth, rot;
  if (rotation !== null) { rot = rotation; const sw = rot === 90 || rot === 270; width = sw ? sz : sx; depth = sw ? sx : sz; }
  else if (Pt.sizes.some(([w, d]) => w === sx && d === sz)) { width = sx; depth = sz; rot = 0; }
  else { width = sz; depth = sx; rot = 90; }
  const b = { shape, width, depth, height, x: i, y: j, z: k, rotation: rot, color };
  const nb = core.normalizeModel({ version: 2, blocks: [{ id: 'p', ...b, step: 1 }] }).blocks[0];
  for (let a = 0; a < sx; a++) for (let c = 0; c < sz; c++) for (let t = 0; t < height; t++) {
    if (occ[idx(i + a, k + c, j + t)]) throw new Error(`collision: ${shape} ${sx}x${sz} at ${i},${j},${k}`);
  }
  const pi = parts.length;
  const below = new Set();
  for (let a = 0; a < sx; a++) for (let c = 0; c < sz; c++) for (let t = 0; t < height; t++) occ[idx(i + a, k + c, j + t)] = 1;
  for (const [cx, cz] of nb.bottomCells) { const o = j > 0 ? studOwner[idx(cx, cz, j)] : -1; if (o >= 0) below.add(o); }
  if (j + height < NY) for (const [cx, cz] of nb.topCells) studOwner[idx(cx, cz, j + height)] = pi;
  parts.push(b);
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
      const ok = ids.every(t => vox[t] && vox[t] !== MAT.reserved && famOf(vox[t]) === f && !occ[t]) && vox[idx(i, k, j + 3)] && !slopeFront[idx(i, k, j + 3)] && !(flags[ids[1]] & FL_HANG) && !(flags[ids[2]] & FL_HANG);
      if (ok) {
        const vis = new Set(ids.filter(t => !hidden[t]).map(t => vox[t]));
        brickCol = vis.size === 0 ? WILD : vis.size === 1 ? [...vis][0] : 'mixed';
      }
    }
    const sup = j === 0 ? -2 : studOwner[id];
    info.set(key, { m, f, col, exposed, brickCol, sup, hang: (flags[id] & FL_HANG) !== 0 });
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
          if (!ci || ci.f !== c0.f) { ok = false; break; }
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
        cands.push({ i, k, a, b, rc, score, shape, alive: true, color });
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
  for (const c of placed) if (c) addPart(c.shape, c.a, c.b, c.i, j, c.k, MATS[c.color]);
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
      try { addPart(s.shape, s.sx, s.sz, s.i, j, s.k, s.color, { rotation: s.rot, h: s.h }); }
      catch (e) { specialFail++; if (process.env.DEBUG_SPECIAL) console.log('special:', e.message); }
    }
    const cells = [];
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) { const m = vox[idx(i, k, j)]; if (m && m !== MAT.reserved && !occ[idx(i, k, j)]) cells.push([i, k]); }
    if (!cells.length) continue;
    let left = [];
    if (cells.length > 4000) {
      const T = 24, off = (j * 5) % 24;         // consecutive levels never share a seam
      const bays = new Map();
      for (const c of cells) { const t = Math.floor((c[0] + off) / T) + ',' + Math.floor((c[1] + off) / T); if (!bays.has(t)) bays.set(t, []); bays.get(t).push(c); }
      for (const bay of bays.values()) left.push(...packLevel(j, bay));
      if (left.length) left = packLevel(j, left);            // across bay seams
    } else left = packLevel(j, cells);
    for (let pass = 0; pass < 3 && left.length; pass++) { const n = left.length; left = packLevel(j, left); if (left.length === n) break; }
    // last resort: a plate hung under the part above (it is grounded through that part)
    if (left.length) {
      const hangers = left.filter(([i, k]) => vox[idx(i, k, j + 1)] && !occ[idx(i, k, j + 1)] && vox[idx(i, k, j + 1)] !== MAT.reserved);
      for (const [i, k] of hangers) flags[idx(i, k, j)] |= FL_HANG;
      if (hangers.length) { const rest = packLevel(j, hangers); hung += hangers.length - rest.length; left = left.filter(c => !hangers.includes(c)).concat(rest); }
    }
    for (const [i, k] of left) { dropped.push({ i, k, j, m: MATS[vox[idx(i, k, j)]] }); vox[idx(i, k, j)] = 0; }
  }
}

if (process.env.DEBUG_Y) {
  const CH = { brick: 'b', stone: 's', plinth: 'p', cornice: 'c', window: 'w', slate: 'S', dome: 'D', 'dome-core': 'd', copper: 'C', reserved: 'R', core: '#', 'roof-core': 'r', floor: '.', door: 'o' };
  for (const y of process.env.DEBUG_Y.split(',').map(Number)) {
    console.log(`--- level ${y}`);
    for (let z = 4; z >= -16; z--) {
      let line = '';
      for (let x = -86; x < 86; x++) { const m = get(x, z, y); line += !m ? ' ' : (CH[MATS[m]] || '?'); }
      console.log(String(z).padStart(4) + ' ' + line);
    }
  }
}

packAll();

/* ------------------------------------------------------------ report */
const notGrounded = parts.filter((p, i) => !grounded[i]).length;
console.log(`slopes ${slopeCount}, closure removed ${closureRemoved}`, JSON.stringify(closureBy));
console.log(`parts ${parts.length}, not grounded ${notGrounded}, dropped voxels ${dropped.length}, hung ${hung}, specials failed ${specialFail}`);
const dropBy = {}; for (const d of dropped) dropBy[d.m] = (dropBy[d.m] || 0) + 1;
console.log('dropped by material:', JSON.stringify(dropBy));
const byShape = {}; for (const p of parts) byShape[p.shape] = (byShape[p.shape] || 0) + 1;
console.log('shapes:', JSON.stringify(byShape));
const byCol = {}; for (const p of parts) byCol[p.color] = (byCol[p.color] || 0) + 1;
console.log('colours:', JSON.stringify(byCol));

/* ------------------------------------------------------------ output */
const COLORS = {
  'base':           { name: 'Base (土台)', hex: '#45484d' },
  'brick':          { name: 'Red Brick (化粧れんが)', hex: '#a8472f', roughness: 0.62 },
  'stone':          { name: 'White Stone Band (白い石の帯)', hex: '#ece5d3', roughness: 0.5 },
  'cornice':        { name: 'Cornice (軒の石)', hex: '#e3dcc8', roughness: 0.5 },
  'plinth':         { name: 'Granite Plinth (花崗岩の腰)', hex: '#8e8a83', roughness: 0.55 },
  'door':           { name: 'Entrance Door (木の扉)', hex: '#4a3326' },
  'core':           { name: 'Structure (構造体)', hex: '#857d71' },
  'window':         { name: 'Window Glass (窓)', hex: '#2e3d4a', roughness: 0.16, metalness: 0.25 },
  'floor':          { name: 'Concourse Floor (床)', hex: '#cbc3b3' },
  'slate':          { name: 'Ogatsu Slate (雄勝産スレート)', hex: '#3b3f46', roughness: 0.55 },
  'roof-core':      { name: 'Roof Structure', hex: '#3b3f46' },
  'roof-lead':      { name: 'Flat Roof (陸屋根)', hex: '#565b62', roughness: 0.5 },
  'dome':           { name: 'Dome Slate (ドームのスレート)', hex: '#3f434a', roughness: 0.5 },
  'dome-core':      { name: 'Dome Structure', hex: '#3f434a' },
  'copper':         { name: 'Copper Trim (銅板)', hex: '#6f5b46', roughness: 0.38, metalness: 0.35 },
  'dormer':         { name: 'Dome Dormer (ドームの小窓)', hex: '#e8e1cf' },
  'lantern':        { name: 'Lantern Window (頂塔の窓)', hex: '#2b3136', roughness: 0.2 },
  'gold':           { name: 'Finial (頂部飾り)', hex: '#c9a14a', roughness: 0.3, metalness: 0.5 },
  'sidewalk':       { name: 'Granite Paving (歩道)', hex: '#b9b3a8' },
  'plaza':          { name: 'Plaza Granite (駅前広場の石張り)', hex: '#d3cbbd' },
  'curb':           { name: 'Curb Stone (縁石)', hex: '#9b958b' },
  'lawn':           { name: 'Lawn (芝生)', hex: '#6a8f3d' },
  'hedge':          { name: 'Hedge (植え込み)', hex: '#3b5b2e' },
  'island':         { name: 'Island Paving (交通島)', hex: '#aaa398' },
  'asphalt':        { name: 'Asphalt (車道)', hex: '#4c4f55', roughness: 0.7 },
  'marking':        { name: 'Road Marking (白線)', hex: '#efefea' },
  'service':        { name: 'Service Yard (構内通路)', hex: '#7d7a74' },
  'ballast':        { name: 'Ballast (バラスト)', hex: '#7c7367', roughness: 0.8 },
  'rail':           { name: 'Rail (レール)', hex: '#9aa0a7', roughness: 0.3, metalness: 0.55 },
  'platform-core':  { name: 'Platform Structure (ホーム)', hex: '#8d8a85' },
  'platform':       { name: 'Platform Paving (ホーム床)', hex: '#bdb9b2' },
  'platform-edge':  { name: 'Platform Edge (ホーム端)', hex: '#e6e4de' },
  'tactile':        { name: 'Tactile Paving (点字ブロック)', hex: '#f0c22e' },
  'steel-post':     { name: 'Canopy Column (上屋の柱)', hex: '#6d737a', roughness: 0.4, metalness: 0.35 },
  'canopy-under':   { name: 'Canopy Frame (上屋の骨組み)', hex: '#8c9197' },
  'canopy':         { name: 'Canopy Roof (上屋)', hex: '#dddcd7' },
  'canopy-edge':    { name: 'Canopy Fascia (上屋の縁)', hex: '#9fa4aa' },
  'steel-body':     { name: 'Stainless Body (ステンレス車体)', hex: '#c9ced4', roughness: 0.28, metalness: 0.45 },
  'chuo-orange':    { name: 'Chuo Line Orange (中央線 E233系)', hex: '#f15a22' },
  'yamanote-green': { name: 'Yamanote Line Green (山手線 E235系)', hex: '#86c043' },
  'keihin-blue':    { name: 'Keihin-Tohoku Sky Blue (京浜東北線)', hex: '#00a7db' },
  'shonan-orange':  { name: 'Shonan Orange (東海道線)', hex: '#f68b1e' },
  'shonan-green':   { name: 'Shonan Green (東海道線)', hex: '#1f8a4c' },
  'train-window':   { name: 'Train Window (車窓)', hex: '#1e252c', roughness: 0.15, metalness: 0.3 },
  'train-front':    { name: 'Cab Front (運転台)', hex: '#1a1c20', roughness: 0.2 },
  'train-roof':     { name: 'Car Roof (屋根)', hex: '#8f949b' },
  'train-ac':       { name: 'Roof Equipment (屋根上機器)', hex: '#6e737a' },
  'bogie':          { name: 'Bogie (台車)', hex: '#2a2c30' },
  'trunk':          { name: 'Tree Trunk (幹)', hex: '#5a4636' },
  'keyaki':         { name: 'Zelkova (ケヤキ)', hex: '#3e6a34' },
  'keyaki-light':   { name: 'Zelkova Light', hex: '#557f3e' },
  'ginkgo':         { name: 'Ginkgo (イチョウ)', hex: '#6b9a38' },
  'ginkgo-light':   { name: 'Ginkgo Light', hex: '#88ae44' },
  'lamp-post':      { name: 'Lamp Post (街灯)', hex: '#2e3237', roughness: 0.4, metalness: 0.3 },
  'lamp-globe':     { name: 'Lamp Globe (灯具)', hex: '#fbf1d4' },
  'taxi':           { name: 'Taxi Indigo (タクシー)', hex: '#1f2a45', roughness: 0.25, metalness: 0.2 },
  'car-glass':      { name: 'Car Glass', hex: '#2a2f37', roughness: 0.15 },
  'bus-under':      { name: 'Bus Chassis', hex: '#2b2d31' },
  'bus-green':      { name: 'Bus Green (都営バス)', hex: '#2e8b57' },
  'bus-body':       { name: 'Bus White', hex: '#f1f0ea' },
  'bus-window':     { name: 'Bus Window', hex: '#23282e', roughness: 0.15 }
};
/* ------------------------------------------------------------ steps */
const B = (y0, title, description, split = 1) => ({ y0, title, description, split });
const BANDS = [
  B(0, '土台のプレート', '濃いグレーの8×8プレートを2層、継ぎ目をずらして敷き詰め、184×112スタッドの土台をつくります（1スタッド＝2m、1プレート＝0.8m）。手前（西）が丸の内駅前広場と行幸通り、奥（東）が線路です。', 3),
  B(1, '地面：広場・車道・線路', '丸の内駅前広場を石張りのタイルで、左右の交通広場と駅前の通りをアスファルトと白線で、奥の線路をバラストのプレートで仕上げます。広場の中央には芝生、行幸通りの向こうには植え込みがあります。駅舎の足もとは花崗岩の腰壁から立ち上げます。', 3),
  B(2, '線路とホーム、花崗岩の腰壁', '線路にレールを通し、ホームを2プレート分かさ上げします。ホームの縁は白、その内側に黄色い点字ブロック。列車の台車を置き、駅舎は花崗岩の腰壁を積んで白い石で押さえます。交通広場にはタクシーと都営バスが並びます。', 3),
  B(4, '1階 — 車寄せのアーチと南北口', '1階の窓を開けながら赤れんがの壁を積みます。窓は壁の奥に1スタッド下げてはめ込み、深い陰影をつくります。南北のドームの正面と、中央の車寄せ（皇室用の貴賓出入口）にはアーチを架けます。ホームには上屋の柱を立て、列車の車体を組みます。', 3),
  B(10, '2階', '白い石の帯（1階の上端と2階の窓台）を回して2階を積みます。東京駅の丸の内駅舎は辰野金吾の設計で、1914年（大正3年）12月20日に開業しました。赤れんがに白い石の帯をめぐらせる意匠は「辰野式」と呼ばれます。', 3),
  B(17, '3階', '3階の窓台と窓を積みます。1945年の空襲で3階とドームは焼失し、戦後は2階建てに八角形の屋根をかけた姿で約60年使われました。2012年の保存・復原工事で、3階と南北のドームが創建時の姿によみがえりました。ホームの上屋はここで屋根を張ります。', 3),
  B(23, '軒の帯と屋根裏階', '3階の上に赤れんがの帯を積み、翼部は白い軒（コーニス）で締めます。中央部・南北のドーム・4つの塔屋はもう1層高く、小さな屋根裏の窓を並べてから軒を張ります。軒は壁から1スタッド張り出します。', 3),
  B(28, '屋根 — スロープの1段目', '天然スレートの寄棟屋根をスロープで葺いていきます。屋根のスレートには宮城県石巻市雄勝（おがつ）産の玄昌石が使われ、東日本大震災の津波で被災したスレートも洗って再利用されました。ドームはここから楕円形の断面で立ち上がり、足もとに銅の帯を巻きます。'),
  B(31, '屋根 — 2段目とドームの小窓', 'スロープを1段ずつ内側へ寄せて積みます。ドームには8方向に小さな窓（ドーマー）を開け、八角形の稜線には銅板の飾りを通します。ドームの内側の天井には、八角形の隅に干支のレリーフ、窓の間に鷲のレリーフが飾られています（模型では中空にしています）。'),
  B(34, '屋根 — 3段目と翼部の棟', '翼部の屋根は3段目で平らな棟になり、スレートのタイルで仕上げます。塔屋と中央部は、もう1段高く積みます。駅舎の中には東京ステーションホテルが入り、ドームの回廊からは改札口を見下ろせます。'),
  B(37, '屋根 — 塔屋と中央部の頂上', '中央部と4つの塔屋の屋根の頂部を平らに仕上げ、銅の棟飾りを載せます。復原工事では、建物を地下で支える「免震構造」が採り入れられ、れんがの駅舎を地震から守っています。'),
  B(42, 'ドームの頂部', 'ドームの屋根を閉じていきます。南北のドームは差し渡し約32mの正八角形で、模型では地面から頂部の飾りまで55プレート（約44m）になります。'),
  B(44, '頂塔（ランタン）と頂部飾り', 'ドームの頂上に小さな八角形の頂塔を載せ、窓を開けて銅の笠をかぶせます。最後に金色の丸ブロックとコーンの頂部飾りを立てて完成です。全長約335mの赤れんがの駅舎が、行幸通りの先の皇居に向かって正面を構えます。')
];
const bandOf = y => { let b = 0; for (let i = 0; i < BANDS.length; i++) if (y - YS >= BANDS[i].y0) b = i; return b; };

const partOrder = parts.map((p, i) => i).sort((a, b) => parts[a].y - parts[b].y || a - b);
const blocks = partOrder.map((pi, n) => {
  const p = parts[pi];
  return { id: `block_${String(n + 1).padStart(5, '0')}`, shape: p.shape, width: p.width, depth: p.depth, height: p.height, x: p.x, y: p.y, z: p.z, rotation: p.rotation, color: p.color, step: 0 };
});
for (const b of blocks) {
  const bi = bandOf(b.y), band = BANDS[bi];
  const part = band.split > 1 ? Math.min(band.split - 1, Math.floor(b.x / (NX / band.split))) : 0;
  b.step = bi * 100 + part;
}
const usedColors = new Set(blocks.map(b => b.color));
for (const c of usedColors) if (!COLORS[c]) throw new Error(`colour ${c} is not defined`);
const raw = {
  format: 'blockmade.model', version: 2,
  name: '東京駅 丸の内駅舎', nameEn: 'Tokyo Station (Marunouchi Building)',
  description: '',
  author: 'Claude', prompt: '超リアルな東京駅', createdAt: '2026-09-24',
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
    if (process.env.DEBUG_PRUNE) { const mm = core.normalizeModel(raw); const by = {}; for (const id of bad) { const b = mm.byId.get(id); const k = b.color + '@' + b.shape; by[k] = (by[k] || 0) + 1; } console.log('prune', chk.supported.floating.length, chk.connected.groups.length, chk.collisions.pairs.length, JSON.stringify(by)); }
    pruned += bad.size;
    raw.blocks = raw.blocks.filter(b => !bad.has(b.id));
  }
  // build order, by simulation (as in gen-sydney-opera-house.mjs): parts that stand on a chain
  // down to the base (DS) go bottom-up, parts hung under them (US) top-down, riders last; a part
  // that would go on too early (a neighbour would later be sandwiched) waits for the next step.
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
  const st = new Set(stuck); dropStuck += st.size;
  raw.blocks = raw.blocks.filter(b => !st.has(b.id));
}
raw.blocks.sort((a, b) => a.step - b.step || a._rank - b._rank);
raw.blocks.forEach(b => { delete b._rank; });
const usedSteps = [...new Set(raw.blocks.map(b => b.step))].sort((a, b) => a - b);
const stepNo = new Map(usedSteps.map((s, i) => [s, i + 1]));
raw.steps = usedSteps.map(s => {
  const band = BANDS[Math.floor(s / 100)], part = s % 100;
  const t = band.split > 1 && part < band.split ? `${band.title}（${['北側', '中央', '南側'][part] || part + 1}）` : part ? `${band.title}（仕上げ${part > 1 ? part : ''}）` : band.title;
  return { step: stepNo.get(s), title: t, description: band.description };
});
raw.blocks.forEach(b => { b.step = stepNo.get(b.step); });
raw.blocks.forEach((b, n) => { b.id = `block_${String(n + 1).padStart(5, '0')}`; });
const m = core.normalizeModel(raw);
const fin = core.validateModel(m);
const bx = m.bounds;
raw.description = `1914年に開業し、2012年に創建時の姿へ復原された東京駅丸の内駅舎を、1スタッド＝2m・1プレート＝0.8mで再現。全長約335mの赤れんがの駅舎に白い石の帯と1スタッド奥にはめた窓、スロープで葺いたスレートの寄棟屋根、楕円断面で立ち上がる南北の八角ドームと頂塔、中央の車寄せのアーチまで。手前には丸の内駅前広場の芝生とケヤキ、タクシー乗り場と都営バス、行幸通りのイチョウ並木、奥には上屋のあるホームと中央線・山手線・京浜東北線・東海道線の電車。${bx.maxX - bx.minX}×${bx.maxZ - bx.minZ}スタッド・高さ${m.heightPlates}プレート・${m.blocks.length}パーツ。`;
writeFileSync(join(root, 'models/tokyo-station.json'), core.modelToJSON(core.normalizeModel(raw)));
console.log(`wrote ${m.blocks.length} parts (pruned ${pruned}, dropped ${dropStuck} unorderable, moved ${moved}), ${raw.steps.length} steps, valid: ${fin.allOk}` + (fin.allOk ? '' : ' ' + core.describeIssues(m, fin, 10).join(' | ')));
