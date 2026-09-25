// Generates models/sagrada-familia.json — the Basílica de la Sagrada Família, Barcelona, as completed.
//   node tools/gen-sagrada-familia.mjs          (then: node tools/validate.mjs && node tools/build.mjs)
//   DEBUG_Y=40,64 node tools/gen-sagrada-familia.mjs   prints plan-view maps of those plate levels
//   DEBUG_STATS=<group> / DEBUG_PRUNE=2 / DEBUG_CLOSURE=1   part counts per level, what gets pruned or cut
//   DEBUG_NG=1 / DEBUG_DROP=<colour> / DEBUG_CELL=x,z   parts not grounded, voxels dropped, parts in one column
//   NOORDER=<file>   skip the build order and write a quick preview to <file>
//
// Scale: 1 stud = 2 m, 1 plate = 0.8 m (one brick course = 2.4 m), the proportion of a real brick.
// The Tower of Jesus Christ, 172.5 m with its cross, is 216 plates; the whole block of the Eixample
// (about 120 m square with chamfered corners) is 60 studs.
// Model frame: +Z = south-east (the Glory façade, Carrer de Mallorca), -Z = north-west (the apse,
// Carrer de Provença), +X = north-east (the Nativity façade, Carrer de la Marina, Plaça de Gaudí),
// -X = south-west (the Passion façade, Carrer de Sardenya).
//
// Pipeline
//   1. ground   — base plates, the block with its chamfered corners, streets, sidewalks, plazas.
//   2. solids   — the building is drawn as solids: the Latin cross (five naves, three-nave transept,
//                 the apse), the eighteen towers as solids of revolution (Gaudí's parabolic profile),
//                 the three façades with their portals as parabolic arches under steep gables.
//   3. hollow   — every voxel whose 26 neighbours are all filled is removed, so walls, towers and
//                 lids are one stud thick and every narrowing of a tower leaves a ledge to stand on.
//   4. details  — stained glass, the louvres of the bell towers, the mosaics of the pinnacles.
//   5. roofs    — steep gable roofs of 45° slopes, lean-to aisle roofs of 2 x 4 slopes.
//   6. pack     — each plate level is covered with real parts, bottom-up (as in gen-kiyomizu-dera.mjs).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = require(join(root, 'js/model-core.js'));
const { PARTS } = core;

/* ------------------------------------------------------------------ grid */
const X_OFF = -44, Z_OFF = -40;          // grid index 0 -> stud -44 / -40
const NX = 88, NZ = 88, NY = 224;
const YS = 0;
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
const FL_HANG = 1, FL_KEEP = 2;                   // KEEP: never hollowed out
let GROUP = 0;
const idx = (i, k, j) => (j * NZ + k) * NX + i;
const inGrid = (i, k, j) => i >= 0 && i < NX && k >= 0 && k < NZ && j >= 0 && j < NY;
const gv = (i, k, j) => inGrid(i, k, j) ? vox[idx(i, k, j)] : 0;
const sv = (i, k, j, m, f = 0) => { if (inGrid(i, k, j)) { const d = idx(i, k, j); vox[d] = typeof m === 'string' ? mat(m) : m; flags[d] = f; grp[d] = GROUP; } };
const get = (x, z, y) => gv(I(x), K(z), y + YS);
const put = (x, z, y, m, f = 0) => sv(I(x), K(z), y + YS, m, f);
const putE = (x, z, y, m, f = 0) => { if (inGrid(I(x), K(z), y + YS) && !get(x, z, y)) put(x, z, y, m, f); };
const recolor = (x, z, y, m) => { const v = get(x, z, y); if (v && v !== MAT.reserved) { const d = idx(I(x), K(z), y + YS); vox[d] = mat(m); } };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* Special parts: placed as they are (slopes, round bricks, cones). Their voxels are 'reserved'
   so the packer leaves them alone and the neighbours count them as filled. */
const SPECIALS = [];
const reserveCell = (x, z, y0, y1) => { for (let y = y0; y < y1; y++) put(x, z, y, 'reserved'); };
function special(shape, x, z, y, color, { sx = 1, sz = 1, rot = null, h = null, reserve = true } = {}) {
  const hh = h ?? PARTS[shape].heights[0];
  if (reserve) for (let a = 0; a < sx; a++) for (let b = 0; b < sz; b++) reserveCell(x + a, z + b, y, y + hh);
  SPECIALS.push({ shape, sx, sz, i: I(x), k: K(z), j: y + YS, color, rot, h: hh, g: GROUP });
}
const freeBox = (x, z, sx, sz, y0, y1) => { for (let a = 0; a < sx; a++) for (let b = 0; b < sz; b++) for (let y = y0; y < y1; y++) if (get(x + a, z + b, y)) return false; return true; };

/* deterministic noise */
function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const hash3 = (x, y, z) => hash2(x * 7919 + y, z * 104729 - y * 31);
function vnoise(x, z, s) {
  const fx = x / s, fz = z / s, x0 = Math.floor(fx), z0 = Math.floor(fz);
  const sm = t => t * t * (3 - 2 * t), tx = sm(fx - x0), tz = sm(fz - z0);
  const a = hash2(x0, z0), b = hash2(x0 + 1, z0), c = hash2(x0, z0 + 1), d = hash2(x0 + 1, z0 + 1);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/* ------------------------------------------------------------------ geometry helpers */
// Heights: the street surface is plate level 1 (top at 2); H(m) is the plate level m metres up.
const G = 2;
const H = m => G + Math.round(m / 0.8);
/** Cells whose centres lie within r of (cx, cz) (continuous stud coordinates). */
const diskCache = new Map();
function disk(cx, cz, r) {
  const key = cx + ',' + cz + ',' + r.toFixed(3);
  if (diskCache.has(key)) return diskCache.get(key);
  const out = [];
  for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++) {
    const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
    if (dx * dx + dz * dz <= r * r + 1e-9) out.push([x, z]);
  }
  diskCache.set(key, out);
  return out;
}
const dist = (x, z, cx, cz) => Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
const ang = (x, z, cx, cz) => Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
function box(x0, x1, z0, z1, y0, y1, m, f = 0) { for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) put(x, z, y, m, f); }
/** Solid of revolution about (cx, cz): radius r(y) for y in [y0, y1); material m(x, z, y) or a key. */
function revolve(cx, cz, y0, y1, rOf, m) {
  for (let y = y0; y < y1; y++) {
    const r = rOf(y);
    if (r <= 0) continue;
    for (const [x, z] of disk(cx, cz, r)) put(x, z, y, typeof m === 'function' ? m(x, z, y) : m);
  }
}
// footprints of everything built: no trees there
const BUILT = [];
const built = (x0, x1, z0, z1) => BUILT.push([x0, x1, z0, z1]);
const isBuilt = (x, z, m = 0) => BUILT.some(b => x >= b[0] - m && x < b[1] + m && z >= b[2] - m && z < b[3] + m);

/* ================================================================== 1. ground */
// Cerdà's Eixample: blocks of 60 studs (about 113 m + walls) on a pitch of 70, streets 10 studs
// (20 m: two 2-stud sidewalks and a 6-stud roadway), corners chamfered (the xamfrà).
const BLK = 60, PITCH = 70, CHAM = 7;
const BX0 = -30, BZ0 = -32;                   // our block: x in [-30, 30), z in [-32, 28)
function blockOf(x, z, e = 0) {
  // which block (i, j) a cell is in, grown by e studs; null if none
  const cx = x + 0.5, cz = z + 0.5;
  const i = Math.floor((cx - BX0 + PITCH / 2 - BLK / 2) / PITCH), j = Math.floor((cz - BZ0 + PITCH / 2 - BLK / 2) / PITCH);
  const x0 = BX0 + i * PITCH - e, x1 = BX0 + i * PITCH + BLK + e, z0 = BZ0 + j * PITCH - e, z1 = BZ0 + j * PITCH + BLK + e;
  if (cx < x0 || cx > x1 || cz < z0 || cz > z1) return null;
  const dx = Math.min(cx - x0, x1 - cx), dz = Math.min(cz - z0, z1 - cz);
  if (dx + dz < CHAM) return null;
  return [i, j];
}
// the Glory façade's stair comes down over Carrer de Mallorca to the esplanade across it
const GLORY_PLAZA = [-18, 18, 28, 48];
const inBox = (x, z, b) => x >= b[0] && x < b[1] && z >= b[2] && z < b[3];
function surfaceMat(x, z) {
  const b = blockOf(x, z);
  if (b) {
    const [i, j] = b;
    if (i === 0 && j === 0) return 'paving';
    if (j === 0 && i !== 0) {                             // Plaça de Gaudí (NE) and Plaça de la Sagrada Família (SW)
      const px = x + 0.5 - (i > 0 ? 40 : -40), pz = z + 0.5;
      if (Math.abs(pz + 2) < 1.5 || Math.abs(px) < 1.5 && pz > -30) return 'sablon';
      return (i > 0 && Math.abs(px) > 2.5 && pz > -16 && pz < 12) ? 'pond' : 'grass';
    }
    return 'paving';
  }
  if (inBox(x, z, GLORY_PLAZA)) return 'paving';
  if (blockOf(x, z, 2)) return 'sidewalk';
  // roadway: a dashed centre line, zebra crossings next to the corners
  const cx = x + 0.5, cz = z + 0.5;
  const onRoadX = !(((cx - BX0) % PITCH + PITCH) % PITCH < BLK);   // between blocks in x: a north-south street
  const onRoadZ = !(((cz - BZ0) % PITCH + PITCH) % PITCH < BLK);
  if (onRoadX && onRoadZ) return 'asphalt';                          // the intersection
  if (onRoadX) {
    const u = ((cz - BZ0) % PITCH + PITCH) % PITCH;                  // along the street
    if ((u > 5 && u < 8) || (u > BLK - 8 && u < BLK - 5)) return Math.floor(cx) % 2 === 0 ? 'zebra' : 'asphalt';
    const mid = ((cx - BX0) % PITCH + PITCH) % PITCH - BLK - 5;
    return Math.abs(mid) < 0.6 && Math.floor(cz / 2) % 2 === 0 ? 'lane' : 'asphalt';
  }
  if (onRoadZ) {
    const u = ((cx - BX0) % PITCH + PITCH) % PITCH;
    if ((u > 5 && u < 8) || (u > BLK - 8 && u < BLK - 5)) return Math.floor(cz) % 2 === 0 ? 'zebra' : 'asphalt';
    const mid = ((cz - BZ0) % PITCH + PITCH) % PITCH - BLK - 5;
    return Math.abs(mid) < 0.6 && Math.floor(cx / 2) % 2 === 0 ? 'lane' : 'asphalt';
  }
  return 'asphalt';
}
function writeGround() {
  GROUP = 0;
  for (let x = X0; x < X1; x += 8) for (let z = Z0; z < Z1; z += 8) special('plate', x, z, 0, 'base', { sx: 8, sz: 8 });
  for (let x = X0; x < X1; x++) for (let z = Z0; z < Z1; z++) put(x, z, 1, surfaceMat(x, z));
  // the kerb: a darker line along the edge of the sidewalk
  for (let x = X0; x < X1; x++) for (let z = Z0; z < Z1; z++) {
    if (get(x, z, 1) !== MAT.sidewalk) continue;
    if (N4.some(([dx, dz]) => { const m = get(x + dx, z + dz, 1); return m === MAT.asphalt || m === MAT.zebra || m === MAT.lane; })) put(x, z, 1, 'kerb');
  }
}
writeGround();

/* ================================================================== 2. the Latin cross */
// Nave: five naves, 24 studs (48 m) wide, from the transept (z = 3) to the Glory narthex (z = 19).
// The aisles are vaulted at 30 m, the central nave at 45 m; the clerestory stands on the aisle roofs.
// Transept: three naves, 18 studs (36 m) wide, centre line z = -6, arms out to the façades at |x| = 16.
// Apse: centre (0, -19), the ring of seven chapels to r = 11, the high apse to r = 7, vault 75 m.
const NAVE = { x0: -12, x1: 12, z0: 3, z1: 19 };
const CN = { x0: -5, x1: 5 };                      // central nave (clerestory walls at x = -5 and 4)
const TR = { x0: -16, x1: 16, z0: -15, z1: 3 };    // transept
const CT = { z0: -11, z1: -1 };                    // central transept nave (walls at z = -11 and -2)
const Y_AISLE = 42, Y_CLER = 64;                   // tops of the aisle walls and of the clerestory
const APSE = { cx: 0, cz: -19, rChap: 10.4, rHigh: 7 };
const Y_CHAP = 40, Y_APSE = 80;
const inChapels = (x, z) => z < -15 && (dist(x, z, APSE.cx, APSE.cz) <= APSE.rChap || (z >= APSE.cz && Math.abs(x + 0.5) <= APSE.rChap));
const inHighApse = (x, z) => z < -15 && (dist(x, z, APSE.cx, APSE.cz) <= APSE.rHigh + 0.2 || (z >= APSE.cz && Math.abs(x + 0.5) <= APSE.rHigh));

GROUP = 1;
box(NAVE.x0, NAVE.x1, NAVE.z0, NAVE.z1, 1, Y_AISLE, 'stone');
box(CN.x0, CN.x1, NAVE.z0, NAVE.z1, Y_AISLE, Y_CLER, 'stone');
box(TR.x0, TR.x1, TR.z0, TR.z1, 1, Y_AISLE, 'stone');
box(TR.x0, TR.x1, CT.z0, CT.z1, Y_AISLE, Y_CLER, 'stone');
box(CN.x0, CN.x1, -16, CT.z0, Y_AISLE, Y_CLER, 'stone');        // the presbytery, between crossing and apse
// the vaults: the tops of the aisles and of the central naves are kept whole (the hollowing would
// otherwise leave them only one stud round the edges)
for (let x = TR.x0; x < TR.x1; x++) for (let z = TR.z0; z < NAVE.z1; z++) for (const y of [Y_AISLE - 1, Y_CLER - 1]) {
  const m = get(x, z, y);
  if (m && get(x, z, y + 1) !== m) flags[idx(I(x), K(z), y + YS)] |= FL_KEEP;
}
built(NAVE.x0, NAVE.x1, NAVE.z0, NAVE.z1); built(TR.x0, TR.x1, TR.z0, TR.z1);

GROUP = 2;
for (let x = -12; x < 12; x++) for (let z = -31; z < -15; z++) {
  if (inChapels(x, z)) for (let y = 1; y < Y_CHAP; y++) putE(x, z, y, 'stone');
  if (inHighApse(x, z)) for (let y = Y_CHAP; y < Y_APSE; y++) put(x, z, y, 'stone');
}
built(-12, 12, -31, -15);

/* ------------------------------------------------------------------ façade frames */
// A façade is laid out in local cells (u outward, s along the façade); frames map them to the world.
const FR = {
  nat: { cell: (u, s) => [u, s - 6], cont: (u, s) => [u, s - 6], out: [1, 0] },
  pas: { cell: (u, s) => [-1 - u, s - 6], cont: (u, s) => [-u, s - 6], out: [-1, 0] },
  glo: { cell: (u, s) => [s, u], cont: (u, s) => [s, u], out: [0, 1] }
};
const fput = (F, u, s, y, m, f = 0) => { const [x, z] = F.cell(u, s); put(x, z, y, m, f); };
const fputE = (F, u, s, y, m, f = 0) => { const [x, z] = F.cell(u, s); putE(x, z, y, m, f); };
const fget = (F, u, s, y) => { const [x, z] = F.cell(u, s); return get(x, z, y); };
const fbox = (F, u0, u1, s0, s1, y0, y1, m, f = 0) => { for (let u = u0; u < u1; u++) for (let s = s0; s < s1; s++) for (let y = y0; y < y1; y++) fput(F, u, s, y, m, f); };

/* ------------------------------------------------------------------ the eighteen towers */
// Every tower is a solid of revolution. The twelve bell towers of the apostles rise square from
// the portals, turn round and narrow on Gaudí's parabolic line, and end in pinnacles of Venetian
// glass mosaic: the bishop's mitre, staff, ring and cross of the apostle.
const TOWERS = [];
function apostle(F, uc, sc, yR, yTop, stone, name) {
  const [cx, cz] = F.cont(uc, sc);
  const yP = yTop - 24;                               // the pinnacle
  for (let u = Math.floor(uc - 2.5); u < uc + 2.5; u++) for (let s = Math.floor(sc - 2.5); s < sc + 2.5; s++) {
    for (let y = 1; y < yR; y++) fput(F, u, s, y, stone);
  }
  const rOf = y => 2.62 - 1.5 * Math.pow((y - yR) / (yP - yR), 2.6);
  revolve(cx, cz, yR, yP, rOf, stone);
  // pinnacle: HOSANNA band, the mitre in white and red, flared, the staff and the cross
  const P = [
    [0, 3, 1.62, (x, z, y) => 'mosaic-gold'],
    [3, 9, 1.62, (x, z, y) => ((x + z + Math.floor(y / 2)) % 2 === 0 ? 'mosaic-red' : 'mosaic-white')],
    [9, 12, 2.1, (x, z, y) => (dist(x, z, cx, cz) > 1.6 ? 'mosaic-white' : 'mosaic-red')],
    [12, 15, 1.62, (x, z, y) => 'mosaic-white'],
    [15, 18, 1.1, (x, z, y) => (dist(x, z, cx, cz) > 0.6 ? 'mosaic-gold' : 'mosaic-white')]
  ];
  for (const [a, b, r, fn] of P) revolve(cx, cz, yP + a, yP + b, () => r, fn);
  const [tx, tz] = [Math.floor(cx), Math.floor(cz)];
  TOWERS.push({ kind: 'apostle', name, cx, cz, yR, yP, yTop, stone, top: [tx, tz, yP + 18] });
}
/** The top of a bell tower, placed after the hollowing: a round brick and a cone on the mitre. */
function apostleTop(t) {
  const [x, z, y] = t.top;
  special('round-brick', x, z, y, 'mosaic-white');
  special('cone', x, z, y + 3, 'mosaic-gold');
}

/* ------------------------------------------------------------------ the Nativity façade (NE, +x) */
// Four towers (Barnabas, Simon, Jude, Matthias), three portals: Hope, Charity (centre) and Faith.
// The portals are deep parabolic arches under steep gables, crusted with sculpture, the Charity
// portal crowned with the green cypress of the Tree of Life and its white doves.
const ST = { nat: ['nat', 'nat-dark', 'nat-light'], pas: ['pas', 'pas-dark', 'pas-light'], glo: ['glo', 'glo-dark', 'glo-light'] };
const TOWER_S = [-14.5, -6.5, 6.5, 14.5];
function portal(F, s0, s1, u0, u1, yArch, yGable, slope, stone, dark, sculpt) {
  // cells s in [s0, s1), depth layers u in [u0, u1); the arch opens wider and higher outward
  const sc = (s0 + s1) / 2, half = (s1 - s0) / 2;
  for (let u = u0; u < u1; u++) {
    const d = (u - u0) / Math.max(1, u1 - u0 - 1);
    const w = half - 0.7 + 0.7 * d, yA = yArch + 3 * d;
    for (let s = s0; s < s1; s++) {
      const ds = Math.abs(s + 0.5 - sc);
      const top = Math.round(yGable - slope * ds);
      const arch = ds < w ? Math.round(1 + (yA - 1) * (1 - (ds / w) ** 2)) : 1;
      for (let y = arch; y < top; y++) {
        let m = stone;
        if (sculpt && u >= u1 - 2 && hash3(u * 3 + s, Math.floor(y / 3), s * 5 + u) < 0.28) m = dark;
        fput(F, u, s, y, m);
      }
    }
  }
}
function nativity() {
  const F = FR.nat, [S, D, L] = ST.nat;
  GROUP = 4;
  // the transept's end, the wall behind the portals
  fbox(F, 16, 21, -9, 9, 1, Y_CLER, S);
  fbox(F, 16, 22, -17, 17, 1, 40, S);
  for (const [i, sc] of TOWER_S.entries()) apostle(F, 24.5, sc, 56, i === 1 || i === 2 ? 136 : 124, S, ['Barnabas', 'Simon', 'Jude', 'Matthias'][i]);
  // Charity (centre, between the inner towers): cells s in [-4, 4), Hope and Faith: [-12, -9) and [9, 12)
  portal(F, -4, 4, 22, 27, 30, 58, 2.1, S, D, true);
  portal(F, -12, -9, 22, 27, 18, 36, 2.4, S, D, true);
  portal(F, 9, 12, 22, 27, 18, 36, 2.4, S, D, true);
  // the portal walls: bronze doors (Charity door with its trumeau), sculpture groups in the shadow
  for (let s = -4; s < 4; s++) for (let y = 1; y < 32; y++) {
    const door = y < 14 && Math.abs(s + 0.5) > 0.6;
    fput(F, 21, s, y, door ? 'bronze-green' : y < 29 && hash3(s, y, 3) > 0.22 ? D : L);
  }
  for (const s0 of [-12, 9]) for (let s = s0; s < s0 + 3; s++) for (let y = 1; y < 20; y++) fput(F, 21, s, y, y < 10 ? 'bronze-green' : D);
  // the cypress: a pedestal of rock on the gable, then the green spire with doves, the Tau and the X
  const [cx, cz] = F.cont(24, 0);
  for (const [x, z] of disk(cx, cz, 2.3)) for (let y = 50; y < 60; y++) putE(x, z, y, S);
  revolve(cx, cz, 60, 82, y => 2.35 * Math.pow(1 - (y - 60) / 23, 0.8), (x, z, y) => hash3(x, y, z) < 0.13 && y > 62 && y < 78 ? 'dove' : 'cypress');
  CYPRESS = [Math.floor(cx), Math.floor(cz)];
  // steps up to the portals
  fbox(F, 27, 29, -17, 17, 1, 2, 'step');
  built(16, 30, -24, 12);
}
let CYPRESS = null;

/* ------------------------------------------------------------------ the Passion façade (SW, -x) */
// Stark and bony: six inclined columns like sequoia trunks carry the portico; above the frieze a
// pediment of eighteen bone-like columns; the gilded risen Christ on the bridge between the towers.
const PAS_COL = [-14, -8, -3, 1, 6, 12];
function passion() {
  const F = FR.pas, [S, D] = ST.pas;
  GROUP = 5;
  fbox(F, 16, 21, -9, 9, 1, Y_CLER, S);
  fbox(F, 16, 22, -17, 17, 1, 40, S);
  for (const [i, sc] of TOWER_S.entries()) apostle(F, 24.5, sc, 56, i === 1 || i === 2 ? 138 : 126, S, ['James', 'Thomas', 'Philip', 'Bartholomew'][i]);
  // the portico: a deep canopy on the six columns and the tower fronts
  fbox(F, 21, 30, -17, 17, 27, 31, S, FL_KEEP);
  // doors of the Gospel, of Gethsemane and of the Crown of Thorns: bronze with text
  for (let s = -17; s < 17; s++) for (let y = 1; y < 27; y++) {
    if (fget(F, 21, s, y)) continue;
    const door = y < 14 && (Math.abs(s + 0.5) < 3.5 || Math.abs(Math.abs(s + 0.5) - 10.5) < 1.2);
    fput(F, 21, s, y, door ? 'bronze' : y > 20 ? D : S);
  }
  // the frieze above the portico, standing out before the towers: sculpture groups in niches
  for (let u = 24; u < 28; u++) for (let s = -14; s < 14; s++) for (let y = 31; y < 46; y++) {
    const niche = u === 27 && (y % 5 >= 1 && y % 5 <= 3) && Math.abs(s + 0.5) % 4 < 2.6;
    fput(F, u, s, y, niche ? D : S);
  }
  built(-31, -15, -24, 12);
}
/** The Passion's specials: inclined columns, the bones of the pediment, the bridge with Christ. */
function passionSpecials() {
  const F = FR.pas;
  GROUP = 5;
  // the six columns lean outward, one stud every 8 plates (2 x 2 bricks overlapping by one stud)
  for (const s0 of PAS_COL) {
    for (let y = 1; y < 27; y += 3) {
      const lean = Math.floor((y - 1) / 9);
      const [xa, za] = F.cell(27 + lean, s0), [xb, zb] = F.cell(28 + lean, s0 + 1);
      special('brick', Math.min(xa, xb), Math.min(za, zb), y, 'pas-light', { sx: 2, sz: 2, h: 3 });
    }
  }
  // eighteen bones on the frieze: round bricks, the tallest at the centre
  for (let s = -9; s < 9; s++) {
    const top = Math.round(66 - 1.7 * Math.abs(s + 0.5));
    const [x, z] = F.cell(27, s);
    for (let y = 46; y + 3 <= top; y += 3) special('round-brick', x, z, y, 'bone');
  }
}

/* ------------------------------------------------------------------ the Glory façade (SE, +z) */
// The main façade: a porch of seven columns (the sacraments) before the doors of the Lord's
// Prayer, sixteen lanterns rising like a cloud, the great window, the four tallest bell towers.
function glory() {
  const F = FR.glo, [S, D] = ST.glo;
  GROUP = 6;
  fbox(F, 19, 23, -17, 17, 1, 52, S);                     // the narthex
  for (const [i, sc] of TOWER_S.entries()) apostle(F, 25.5, sc, 64, i === 1 || i === 2 ? 142 : 130, S, ['Andrew', 'Peter', 'Paul', 'James the Less'][i]);
  // the central gable of the nave, with the great window
  for (let s = -4; s < 4; s++) {
    const top = Math.round(94 - 3.2 * Math.abs(s + 0.5));
    for (let u = 19; u < 23; u++) for (let y = 52; y < top; y++) fput(F, u, s, y, S);
  }
  for (let s = -9; s < 9; s++) for (let u = 19; u < 23; u++) for (let y = 52; y < 64; y++) fputE(F, u, s, y, S);
  // the porch platform over the street level
  fbox(F, 23, 34, -18, 18, 1, 6, S, FL_KEEP);
  for (let st = 0; st < 4; st++) fbox(F, 34 + st, 35 + st, -16, 16, 1, 5 - st, 'step');
  // the porch roof on the columns and towers
  fbox(F, 23, 34, -17, 17, 33, 36, S, FL_KEEP);
  // doors at the back of the porch
  for (let s = -17; s < 17; s++) for (let y = 6; y < 33; y++) {
    const door = y < 18 && (Math.abs(s + 0.5) < 3.2 || Math.abs(Math.abs(s + 0.5) - 10.5) < 1.2);
    fput(F, 22, s, y, door ? 'bronze' : y < 26 ? D : S);
  }
  built(-18, 18, 19, 38);
}
function glorySpecials() {
  const F = FR.glo;
  GROUP = 6;
  // seven columns of the porch, round 2 x 2 bricks on a dark base
  for (let n = -3; n <= 3; n++) {
    const s = 4 * n - 1, [x, z] = F.cell(31, s);
    special('round-plate', x, z, 6, 'glo-dark', { sx: 2, sz: 2 });
    for (let y = 7; y + 3 <= 33; y += 3) special('round-brick', x, z, y, 'glo-light', { sx: 2, sz: 2 });
    for (let y = 7 + 3 * Math.floor((33 - 7) / 3); y < 33; y++) special('round-plate', x, z, y, 'mosaic-gold', { sx: 2, sz: 2 });
  }
  // sixteen lanterns on the porch roof: seven over the columns, nine behind them, rising to the centre
  const lantern = (s, u, h) => {
    const [x, z] = F.cell(u, s);
    let y = 36;
    for (let n = 0; n < h; n++, y += 3) special('round-brick', x, z, y, n % 3 === 2 ? 'mosaic-gold' : 'glo-light', { sx: 2, sz: 2 });
    special('round-plate', x, z, y, 'mosaic-gold', { sx: 2, sz: 2 }); y++;
    special('cone', x, z, y, 'mosaic-white', { sx: 2, sz: 2, h: 6 });
  };
  for (let n = -3; n <= 3; n++) lantern(4 * n - 1, 31, 7 - Math.abs(n) * 2);
  for (let n = -4; n <= 4; n++) lantern(4 * n - 1, 28, 10 - Math.abs(n) * 2);
}

/* ------------------------------------------------------------------ the central towers */
// The Tower of Jesus Christ over the crossing (172.5 m with its cross), the four Evangelists on the
// crossing's corner columns (135 m) and the Tower of the Virgin Mary over the apse (138 m, star).
const JESUS = { cx: 0, cz: -6 };
const EVANG = [
  { cx: 6.5, cz: -12.5, sym: 'bull', name: 'Luke' }, { cx: 6.5, cz: 0.5, sym: 'eagle', name: 'John' },
  { cx: -6.5, cz: 0.5, sym: 'angel', name: 'Matthew' }, { cx: -6.5, cz: -12.5, sym: 'lion', name: 'Mark' }
];
const Y_EV = H(135), Y_MARY = H(138), Y_JESUS = H(172.5);
function evangelists() {
  for (const e of EVANG) {
    GROUP = 1;                                           // the great column inside the church
    revolve(e.cx, e.cz, 1, Y_CLER, () => 2.62, 'tower');
    // (kept through the hollowing: inside the church it is a free-standing column)
    for (const [x, z] of disk(e.cx, e.cz, 2.62)) if (dist(x, z, e.cx, e.cz) > 1.5) for (let y = 1; y < Y_CLER; y++) flags[idx(I(x), K(z), y + YS)] |= FL_KEEP;
    GROUP = 7;
    const yC = Y_EV - 22;
    revolve(e.cx, e.cz, Y_CLER, yC, y => 2.62 - 0.75 * Math.pow((y - Y_CLER) / (yC - Y_CLER), 1.6), 'tower');
    // the crown of white ceramic, with the openings of its lantern
    revolve(e.cx, e.cz, yC, yC + 12, y => y < yC + 9 ? 2.15 : 1.62, (x, z, y) => (y >= yC + 3 && y < yC + 8 && (x + z) % 2 === 0 ? 'crown-glass' : 'ceramic'));
    const [x0, z0] = [Math.floor(e.cx), Math.floor(e.cz)], y = yC + 12;
    column(x0, z0, y, y + 4, 'ceramic');
    // the symbol, in white ceramic with gilding, standing on the top of the crown
    if (e.sym === 'eagle') for (let d = -3; d <= 3; d++) { put(x0 + d, z0, y, 'ceramic'); if (Math.abs(d) <= 1) put(x0 + d, z0, y + 1, 'ceramic'); }
    if (e.sym === 'angel') for (let yy = y; yy < y + 4; yy++) for (const d of [-1, 1]) put(x0 + d, z0, yy, 'ceramic');
    if (e.sym === 'bull') for (let yy = y; yy < y + 3; yy++) for (const d of [-1, 1]) put(x0 + d, z0, yy, yy === y ? 'ceramic' : 'mosaic-gold');
    if (e.sym === 'lion') for (let yy = y; yy < y + 2; yy++) for (const [dx, dz] of N4) put(x0 + dx, z0 + dz, yy, 'mosaic-gold');
    TOWERS.push({ kind: 'evangelist', ...e, top: [x0, z0, y + 4] });
  }
}
const column = (x, z, y0, y1, m) => { for (let y = y0; y < y1; y++) put(x, z, y, m); };
function jesus() {
  GROUP = 9;
  const { cx, cz } = JESUS, yL = Y_JESUS - 36;       // the lantern
  const rOf = y => y < 78 ? 4.6 : 4.6 - 2.2 * Math.pow((y - 78) / (yL - 78), 1.25);
  revolve(cx, cz, Y_CLER, yL, rOf, (x, z, y) => {
    const a = ang(x, z, cx, cz), sec = Math.floor((a / (2 * Math.PI) + 1) * 16 + 0.5) % 16;
    if (y > yL - 30) return sec % 2 ? 'ceramic' : 'tower-light';
    return sec % 2 ? 'tower' : 'tower-light';
  });
  // the glazed lantern and the four-armed cross of white ceramic and glass (17 m, arms 13.5 m)
  revolve(cx, cz, yL, yL + 12, () => 2.35, (x, z, y) => ((x + z + y) % 3 === 0 ? 'ceramic' : 'crown-glass'));
  revolve(cx, cz, yL + 12, yL + 15, () => 1.6, 'ceramic');
  const x0 = -1, z0 = -7;                               // the 2 x 2 shaft of the cross
  for (let y = yL + 15; y < Y_JESUS; y++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(x0 + dx, z0 + dz, y, y > Y_JESUS - 14 && y < Y_JESUS - 6 ? 'cross-glass' : 'ceramic');
  const ya = Y_JESUS - 13;
  for (let y = ya; y < ya + 4; y++) for (let d = -3; d < 5; d++) for (let w = 0; w < 2; w++) {
    put(x0 + d, z0 + w, y, Math.abs(d - 0.5) < 1.6 ? 'cross-glass' : 'ceramic');
    put(x0 + w, z0 + d, y, Math.abs(d - 0.5) < 1.6 ? 'cross-glass' : 'ceramic');
  }
  built(-6, 6, -12, 0);
}
let MARY_TOP = null;
function mary() {
  GROUP = 8;
  const { cx, cz } = APSE, y0 = Y_APSE, y1 = 96, yC = Y_MARY - 16;
  // the apse roof narrows in steps to the base of the tower
  for (let y = y0; y < y1; y++) {
    const r = lerp(APSE.rHigh + 0.2, 4.25, (y - y0) / (y1 - y0));
    for (const [x, z] of disk(cx, cz, r)) if (z < -15) put(x, z, y, 'stone');
  }
  revolve(cx, cz, y1, yC, y => 4.25 - 1.9 * Math.pow((y - y1) / (yC - y1), 1.3), (x, z, y) => {
    const a = ang(x, z, cx, cz), sec = Math.floor((a / (2 * Math.PI) + 1) * 12) % 12;
    return y > yC - 24 && sec % 2 ? 'ceramic' : 'tower-light';
  });
  // the crown of glass under the star
  revolve(cx, cz, yC, yC + 6, () => 2.2, (x, z, y) => ((x + y) % 2 ? 'crown-glass' : 'ceramic'));
  revolve(cx, cz, yC + 6, yC + 8, () => 1.6, 'ceramic');
  // the twelve-pointed star of glass and steel (lit at night): a 2 x 2 core with points
  const x0 = -1, z0 = -20, ys = yC + 8;
  for (let y = ys; y < Y_MARY - 2; y++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(x0 + dx, z0 + dz, y, 'star');
  for (let y = ys; y < ys + 3; y++) for (const [dx, dz] of [[-1, 0], [-1, 1], [2, 0], [2, 1], [0, -1], [1, -1], [0, 2], [1, 2]]) put(x0 + dx, z0 + dz, y, 'star');
  MARY_TOP = [x0, z0, Y_MARY - 2];
}

/* ------------------------------------------------------------------ cloister, sacristies, school */
const SACR = [{ cx: 22.5, cz: -26.5 }, { cx: -22.5, cz: -26.5 }];
function annexes() {
  GROUP = 10;
  // the cloister: a walk round the apse between the sacristies, arcades facing the street
  const Y_CL = 14;
  box(-19, 19, -32, -30, 1, Y_CL, 'cloister');
  for (const sx of [1, -1]) {
    const [a, b] = sx > 0 ? [16, 19] : [-19, -16];
    box(a, b, -30, -23, 1, Y_CL, 'cloister');
  }
  for (const s of SACR) {
    revolve(s.cx, s.cz, 1, 16, () => 3.7, 'cloister');
    revolve(s.cx, s.cz, 16, 46, y => 3.7 * Math.sqrt(1 - (y - 16) / 32), (x, z, y) => {
      const a = ang(x, z, s.cx, s.cz), sec = Math.floor((a / (2 * Math.PI) + 1) * 12) % 12;
      return sec % 2 ? 'stone-light' : 'stone';
    });
    revolve(s.cx, s.cz, 46, 52, y => y < 49 ? 1.1 : 0.6, (x, z, y) => (y < 49 ? 'mosaic-gold' : 'mosaic-white'));
    built(Math.floor(s.cx - 4), Math.ceil(s.cx + 4), Math.floor(s.cz - 4), Math.ceil(s.cz + 4));
  }
  // the Sagrada Família schools (1909): a small building with a wavy brick roof, by the Passion façade
  for (let x = -29; x < -20; x++) for (let z = 14; z < 19; z++) {
    const wave = Math.round(1.6 * Math.sin((x + 29) * 0.9));
    const edge = x === -29 || x === -21 || z === 14 || z === 18;
    const top = 10 + wave;
    for (let y = 1; y < top; y++) put(x, z, y, edge && y > 3 && y < 7 && (x + z) % 2 === 0 ? 'school-window' : 'school-brick');
    put(x, z, top, 'school-roof');
  }
  built(-29, -20, 14, 19);
}

/* ------------------------------------------------------------------ build all solids */
nativity();
passion();
glory();
evangelists();
jesus();
mary();
annexes();

/* ================================================================== 3. hollow */
// A voxel whose 26 neighbours are all filled is inside a solid: remove it. What is left is a shell
// one stud thick; where a solid narrows, the shell keeps a ledge under the narrower part.
let hollowed = 0;
const SOLID = vox.slice();                        // the solids before hollowing (roofs keep out of them)
const solidAt = (x, z, y) => { const i = I(x), k = K(z), j = y + YS; return inGrid(i, k, j) && SOLID[idx(i, k, j)] !== 0; };
{
  const rm = [];
  for (let j = 2; j < NY - 1; j++) for (let k = 1; k < NZ - 1; k++) for (let i = 1; i < NX - 1; i++) {
    const id = idx(i, k, j), m = vox[id];
    if (!m || m === MAT.reserved || grp[id] === 0 || (flags[id] & FL_KEEP)) continue;
    let all = true;
    for (let dj = -1; dj <= 1 && all; dj++) for (let dk = -1; dk <= 1 && all; dk++) for (let di = -1; di <= 1; di++) {
      if (!vox[idx(i + di, k + dk, j + dj)]) { all = false; break; }
    }
    if (all) rm.push(id);
  }
  for (const id of rm) { vox[id] = 0; flags[id] = 0; }
  hollowed = rm.length;
  // the floor inside the church and the towers
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
    const id = idx(i, k, 1);
    if (grp[id] !== 0 && vox[id] && !vox[idx(i, k, 2)]) vox[id] = mat('floor');
  }
}

/* ================================================================== 4. details */
// Stained glass: cool blues and greens on the Nativity side (sunrise), reds, oranges and yellows on
// the Passion side (sunset), as Joan Vila-Grau designed them.
const GLASS_E = ['glass-green', 'glass-blue', 'glass-blue', 'glass-cyan'];
const GLASS_W = ['glass-red', 'glass-orange', 'glass-orange', 'glass-yellow'];
const glassOf = (east, y, y0, y1) => (east ? GLASS_E : GLASS_W)[clamp(Math.floor((y - y0) / (y1 - y0) * 4), 0, 3)];
const ARCHES = [];
/** A window in a straight wall: glass cells, a mullion band, an arch 1 x 4 on top. */
function windowZ(x, z0, y0, y1, east) {           // wall along z at x; the arch spans z0 - 1 .. z0 + 2
  for (let z = z0; z < z0 + 2; z++) for (let y = y0; y < y1; y++) if (get(x, z, y) && get(x, z, y) !== MAT.reserved) recolor(x, z, y, (y - y0) % 12 === 11 ? 'stone' : glassOf(east, y, y0, y1));
  ARCHES.push([x, z0 - 1, y1, 1, 4, 0]);
}
function windowX(x0, z, y0, y1, east) {
  for (let x = x0; x < x0 + 2; x++) for (let y = y0; y < y1; y++) if (get(x, z, y) && get(x, z, y) !== MAT.reserved) recolor(x, z, y, (y - y0) % 12 === 11 ? 'stone' : glassOf(east, y, y0, y1));
  ARCHES.push([x0 - 1, z, y1, 4, 1, 90]);
}
const BAYS = [4, 8, 12, 16];
for (const z of BAYS) {
  windowZ(11, z, 6, 33, true); windowZ(-12, z, 6, 33, false);           // aisles
  windowZ(4, z, 50, 60, true); windowZ(-5, z, 50, 60, false);           // clerestory
}
windowX(13, 2, 6, 33, true); windowX(-15, 2, 6, 33, false);             // transept arms, south
windowX(13, -15, 6, 33, true); windowX(-15, -15, 6, 33, false);         // transept arms, north
// the apse: tall lancets in the high apse, lower ones in the chapels
for (let x = -12; x < 12; x++) for (let z = -31; z < -15; z++) {
  const d = dist(x, z, APSE.cx, APSE.cz), a = ang(x, z, APSE.cx, APSE.cz);
  const east = x >= 0;
  const sec = Math.floor((a + Math.PI) / (Math.PI / 9));
  for (let y = 2; y < Y_APSE; y++) {
    const m = get(x, z, y);
    if (!m || m === MAT.reserved) continue;
    if (d > APSE.rHigh - 1.2 && d <= APSE.rHigh + 0.3 && y >= 46 && y < 76 && sec % 2 === 0 && (y - 46) % 10 !== 9) recolor(x, z, y, glassOf(east, y, 46, 76));
    if (d > APSE.rChap - 1.2 && y >= 8 && y < 30 && sec % 2 === 1 && (y - 8) % 11 !== 10) recolor(x, z, y, glassOf(east, y, 8, 30));
  }
}
// the bell towers: louvres in a helix round the shaft (the openings that let the bells be heard,
// with the words Sanctus, Sanctus, Sanctus spiralling up)
for (const t of TOWERS) {
  if (t.kind !== 'apostle') continue;
  for (let y = t.yR + 6; y < t.yP - 3; y++) {
    const c = Math.floor((y - t.yR) / 3);
    for (const [x, z] of disk(t.cx, t.cz, 3)) {
      const m = get(x, z, y);
      if (!m || m === MAT.reserved) continue;
      if (N4.every(([dx, dz]) => get(x + dx, z + dz, y))) continue;       // not on the surface
      const n = ((Math.round(ang(x, z, t.cx, t.cz) / (2 * Math.PI) * 16) % 16) + 16) % 16;
      if (n % 4 === 0 && (c + n / 4) % 4 < 2 && dist(x, z, t.cx, t.cz) > 1.9) recolor(x, z, y, 'louver');
    }
  }
}
// the Nativity: weathered stone, darker where the rain runs
for (let x = 14; x < 30; x++) for (let z = -24; z < 12; z++) for (let y = 2; y < 140; y++) {
  const m = get(x, z, y);
  if (m !== MAT.nat) continue;
  const n = vnoise(x * 1.3 + z * 0.4, y * 0.35 + z, 3.2);
  if (n < 0.3) recolor(x, z, y, 'nat-dark'); else if (n > 0.74) recolor(x, z, y, 'nat-light');
}

/* ================================================================== 5. roofs and pinnacles */
GROUP = 3;
let slopeCount = 0;
function placeSlope(x, z, sx, sz, y, rot, color, frontCells) {
  for (let a = 0; a < sx; a++) for (let b = 0; b < sz; b++) reserveCell(x + a, z + b, y, y + 3);
  for (const [fx, fz] of frontCells) for (let yy = y; yy < y + 3; yy++) slopeFront[idx(I(fx), K(fz), yy + YS)] = 1;
  SPECIALS.push({ shape: 'slope', sx, sz, i: I(x), k: K(z), j: y + YS, color, rot, h: 3, g: GROUP });
  slopeCount++;
}
/**
 * One course of slopes along an eave. The eave runs along `along` (b in [b0, b1)); the course's
 * front row is at `a` (the across coordinate) and the part is `dd` rows deep, rising inward (dir).
 * axis 'z': a is x, b is z;  axis 'x': a is z, b is x.  dir = -1: inward is -a (eave on the + side).
 */
function slopeCourse(axis, a, dir, b0, b1, y, dd, color, fill) {
  const rot = axis === 'z' ? (dir < 0 ? 90 : 270) : (dir < 0 ? 0 : 180);
  const widths = PARTS.slope.sizes.filter(([, d]) => d === dd).map(([w]) => w).sort((p, q) => q - p);
  const cellOf = (t, b) => axis === 'z' ? [a + dir * t, b] : [b, a + dir * t];
  let b = b0;
  while (b < b1) {
    let done = false;
    for (const w of widths) {
      if (b + w > b1) continue;
      let ok = true;
      for (let bb = b; bb < b + w && ok; bb++) for (let t = 0; t < dd && ok; t++) { const [x, z] = cellOf(t, bb); for (let yy = y; yy < y + 3; yy++) if (get(x, z, yy) || solidAt(x, z, yy)) { ok = false; break; } }
      if (!ok) continue;
      const cells = []; for (let bb = b; bb < b + w; bb++) for (let t = 0; t < dd; t++) cells.push(cellOf(t, bb));
      const xs = cells.map(c => c[0]), zs = cells.map(c => c[1]);
      const front = []; for (let bb = b; bb < b + w; bb++) for (let t = 0; t < dd - 1; t++) front.push(cellOf(t, bb));
      placeSlope(Math.min(...xs), Math.min(...zs), Math.max(...xs) - Math.min(...xs) + 1, Math.max(...zs) - Math.min(...zs) + 1, y, rot, color, front);
      b += w; done = true; break;
    }
    if (!done) {
      if (fill) for (let t = 0; t < dd; t++) { const [x, z] = cellOf(t, b); for (let yy = y; yy < y + 3; yy++) if (!solidAt(x, z, yy)) putE(x, z, yy, fill); }
      b++;
    }
  }
}
/** Something with studs on top right below level y (not the sloped face of a slope). */
const studsAt = (x, z, y) => { const m = get(x, z, y - 1); return m && !slopeFront[idx(I(x), K(z), y - 1 + YS)] && !solidAt(x, z, y); };
/** Gable roof with 45° slopes: ridge along `axis`, eaves at a0 and a1 - 1 (a1 - a0 even). */
function gable(axis, a0, a1, b0, b1, yb, color, ridge) {
  const half = (a1 - a0) / 2;
  for (let k = 0; k < half - 1; k++) {
    slopeCourse(axis, a0 + k, 1, b0, b1, yb + 3 * k, 2, color, 'roof');
    slopeCourse(axis, a1 - 1 - k, -1, b0, b1, yb + 3 * k, 2, color, 'roof');
  }
  const yr = yb + 3 * (half - 1);
  for (let b = b0; b < b1; b++) for (const a of [a0 + half - 1, a0 + half]) {
    const [x, z] = axis === 'z' ? [a, b] : [b, a];
    if (studsAt(x, z, yr) && !get(x, z, yr) && !solidAt(x, z, yr)) put(x, z, yr, ridge);
  }
}
gable('z', CN.x0, CN.x1, NAVE.z0, NAVE.z1, Y_CLER, 'roof', 'roof-ridge');
gable('x', CT.z0, CT.z1, TR.x0, TR.x1, Y_CLER, 'roof', 'roof-ridge');
gable('z', CN.x0, CN.x1, -16, CT.z0, Y_CLER, 'roof', 'roof-ridge');
// lean-to roofs of the aisles: 2 x 4 slopes, two courses on the nave, one on the transept
for (const [a, dir] of [[NAVE.x1 - 1, -1], [NAVE.x0, 1]]) {
  slopeCourse('z', a, dir, -1, NAVE.z1, Y_AISLE, 4, 'roof', 'roof');
  slopeCourse('z', a + 3 * dir, dir, -1, NAVE.z1, Y_AISLE + 3, 4, 'roof', 'roof');
  for (let z = -1; z < NAVE.z1; z++) { const x = a + 6 * dir; if (studsAt(x, z, Y_AISLE + 6) && !get(x, z, Y_AISLE + 6)) put(x, z, Y_AISLE + 6, 'roof-ridge'); }
}
for (const [x0, x1] of [[-16, -12], [12, 16], [-12, 12]]) {
  slopeCourse('x', TR.z0, 1, x0, x1, Y_AISLE, 4, 'roof', 'roof');          // north aisle of the transept
  for (let x = x0; x < x1; x++) if (studsAt(x, TR.z0 + 3, Y_AISLE + 3) && !get(x, TR.z0 + 3, Y_AISLE + 3)) put(x, TR.z0 + 3, Y_AISLE + 3, 'roof-ridge');
}
for (const [x0, x1] of [[-16, -12], [12, 16]]) {
  slopeCourse('x', TR.z1 - 1, -1, x0, x1, Y_AISLE, 4, 'roof', 'roof');     // south aisle, outside the nave
  for (let x = x0; x < x1; x++) if (studsAt(x, TR.z1 - 4, Y_AISLE + 3) && !get(x, TR.z1 - 4, Y_AISLE + 3)) put(x, TR.z1 - 4, Y_AISLE + 3, 'roof-ridge');
}
// pinnacles on the buttresses of the aisles: ears of wheat in gold (the bread of the Eucharist)
const PIERS = [[6, 7], [10, 11], [14, 15]];
const PINNACLES = [];
for (const [za, zb] of PIERS) for (const x of [12, -13]) {
  for (const z of [za, zb]) for (let y = 1; y < 44; y++) put(x, z, y, 'stone');
  PINNACLES.push({ kind: 'wheat', x, z: za, y: 44 });
}
// on the clerestory: baskets of fruit (the fruits of the Spirit), each of its own kind
const FRUITS = [['fruit-orange', 'fruit-yellow'], ['fruit-red', 'fruit-purple'], ['fruit-yellow', 'fruit-green'], ['fruit-purple', 'fruit-red'], ['fruit-green', 'fruit-orange'], ['fruit-red', 'fruit-yellow']];
{
  let n = 0;
  for (const [za, zb] of PIERS) for (const x of [CN.x1, CN.x0 - 1]) {
    if (get(x, za, Y_AISLE + 6) || get(x, zb, Y_AISLE + 6)) continue;
    for (const z of [za, zb]) for (let y = Y_AISLE + 6; y < 62; y++) put(x, z, y, 'stone');
    PINNACLES.push({ kind: 'fruit', x, z: za, y: 62, out: x > 0 ? 1 : -1, fruit: FRUITS[n++ % FRUITS.length] });
  }
}
// the apse: seven chapels, each with its pinnacle
for (let k = 0; k <= 6; k++) {
  const th = Math.PI + k * Math.PI / 6;
  const px = APSE.cx + 9.3 * Math.cos(th), pz = APSE.cz + 9.3 * Math.sin(th);
  const x = Math.round(px) - 1, z = Math.min(-17, Math.round(pz) - 1);
  GROUP = 2;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let y = Y_CHAP; y < 50; y++) put(x + a, z + b, y, 'stone-light');
  PINNACLES.push({ kind: 'apse', x, z, y: 50 });
}
GROUP = 3;

// special parts on top of the shells
for (const [x, z, y, sx, sz, rot] of ARCHES) {
  let ok = true;
  for (let a = 0; a < sx; a++) for (let c = 0; c < sz; c++) for (let yy = y; yy < y + 3; yy++) if (get(x + a, z + c, yy) === MAT.reserved) ok = false;
  const ends = sx > 1 ? [[x, z], [x + sx - 1, z]] : [[x, z], [x, z + sz - 1]];
  if (!ok || ends.some(([ex, ez]) => !get(ex, ez, y - 1))) continue;
  GROUP = 1;
  special('arch', x, z, y, 'stone', { sx, sz, rot, h: 3 });
}
GROUP = 3;
for (const p of PINNACLES) {
  if (p.kind === 'wheat') {
    for (const z of [p.z, p.z + 1]) { put(p.x, z, p.y, 'mosaic-white'); special('round-brick', p.x, z, p.y + 1, 'mosaic-gold'); special('cone', p.x, z, p.y + 4, 'mosaic-gold'); }
  } else if (p.kind === 'fruit') {
    const cells = [[p.x, p.z], [p.x, p.z + 1], [p.x + p.out, p.z], [p.x + p.out, p.z + 1]];
    for (const [x, z] of cells) put(x, z, p.y, 'fruit-basket');
    cells.forEach(([x, z], n) => special('round-brick', x, z, p.y + 1, p.fruit[n % 2]));
    cells.forEach(([x, z], n) => { if (n === 0 || n === 3) special('round-plate', x, z, p.y + 4, p.fruit[(n + 1) % 2]); });
  } else if (p.kind === 'apse') {
    GROUP = 2;
    special('round-brick', p.x, p.z, p.y, 'mosaic-white', { sx: 2, sz: 2 });
    special('cone', p.x, p.z, p.y + 3, 'mosaic-gold', { sx: 2, sz: 2, h: 6 });
    GROUP = 3;
  }
}
for (const t of TOWERS) {
  if (t.kind === 'apostle') { GROUP = { nat: 4, pas: 5, glo: 6 }[t.stone]; apostleTop(t); }
  else if (t.kind === 'evangelist') { GROUP = 7; const [x, z, y] = t.top; special('round-brick', x, z, y, 'ceramic'); special('cone', x, z, y + 3, 'mosaic-gold'); }
}
passionSpecials();
glorySpecials();
{
  GROUP = 8;
  special('round-plate', MARY_TOP[0], MARY_TOP[1], MARY_TOP[2], 'star', { sx: 2, sz: 2 });
  // the cypress: a red Tau cross with the X on top, a white dove
  GROUP = 4;
  const [x, z] = CYPRESS;
  let y = 60;
  while (get(x, z, y)) y++;
  special('round-brick', x, z, y, 'mosaic-red'); special('round-plate', x, z, y + 3, 'dove');
}

/* ================================================================== 6. trees */
// London plane trees along the sidewalks of the Eixample, a few in the plazas.
const TREE_FAMILY = { 'plane': 'tree', 'plane-light': 'tree', 'plane-dark': 'tree' };
let treeCount = 0;
/** A plane tree: a trunk of three round bricks, a 2 x 2 plate and a 4 x 4 plate to spread the
 *  crown, then two brick courses of foliage round the grid point (x + 1, z + 1). */
function tree(x, z, scale) {
  const cx = x + 1, cz = z + 1;
  if (x - 1 < X0 || x + 3 > X1 || z - 1 < Z0 || z + 3 > Z1) return false;
  for (let y = 2; y < 20; y++) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (get(x + a, z + b, y)) return false;
  for (let dx = -3; dx < 3; dx++) for (let dz = -3; dz < 3; dz++) if (dist(cx + dx, cz + dz, cx, cz) <= 2.6 * scale && (get(cx + dx, cz + dz, 12) || isBuilt(cx + dx, cz + dz))) return false;
  for (let n = 0; n < 3; n++) special('round-brick', x, z, 2 + 3 * n, 'trunk');
  special('plate', x, z, 11, 'plane-dark', { sx: 2, sz: 2 });
  special('plate', x - 1, z - 1, 12, 'plane', { sx: 4, sz: 4 });
  const tone = hash2(x, z) < 0.35 ? 'plane-dark' : 'plane';
  for (const [x1, z1] of disk(cx, cz, 2.6 * scale)) for (let y = 13; y < 16; y++) putE(x1, z1, y, tone);
  for (const [x1, z1] of disk(cx, cz, 2.0)) for (let y = 16; y < 19; y++) putE(x1, z1, y, 'plane');
  for (const [x1, z1] of disk(cx, cz, 1.2)) putE(x1, z1, 19, 'plane-light');
  treeCount++;
  return true;
}
GROUP = 11;
for (let x = X0 + 2; x < X1 - 2; x++) for (let z = Z0 + 2; z < Z1 - 2; z++) {
  if (get(x, z, 1) !== MAT.sidewalk || isBuilt(x, z, 3) || inBox(x, z, GLORY_PLAZA)) continue;
  const kx = N4.find(([dx, dz]) => get(x + dx, z + dz, 1) === MAT.kerb);
  if (kx && get(x + 1, z + 1, 1) !== MAT.sidewalk && get(x + 1, z + 1, 1) !== MAT.kerb) continue;
  if (!kx) continue;
  const along = kx[0] !== 0 ? z : x;
  if (((along % 7) + 7) % 7 !== 3) continue;
  tree(x, z, 0.9 + hash2(x, z) * 0.2);
}
for (const [x, z] of [[41, -26], [41, -12], [41, 16], [-43, -26], [-43, -12], [-43, 4], [-43, 18], [4, 44], [-10, 44], [12, 42]]) tree(x, z, 1.05);

/* ------------------------------------------------------------------ traffic */
// Black-and-yellow Barcelona taxis, cars and the red tourist buses of the Bus Turístic.
GROUP = 0;
const VEHICLES = [
  // [x, z, along x?, length, body, roof]
  [33, -24, false, 2, 'taxi-black', 'taxi-yellow'], [36, -10, false, 2, 'car-white', 'car-glass'], [33, 2, false, 6, 'bus-red', 'bus-roof'],
  [36, 20, false, 2, 'taxi-black', 'taxi-yellow'], [34, 40, false, 2, 'car-blue', 'car-glass'],
  [-34, -18, false, 2, 'car-gray', 'car-glass'], [-37, -2, false, 2, 'taxi-black', 'taxi-yellow'], [-35, 18, false, 6, 'bus-red', 'bus-roof'],
  [-24, 31, true, 2, 'taxi-black', 'taxi-yellow'], [22, 34, true, 2, 'car-red', 'car-glass'], [26, 31, true, 2, 'taxi-black', 'taxi-yellow'],
  [-12, -38, true, 2, 'car-white', 'car-glass'], [6, -35, true, 6, 'bus-red', 'bus-roof'], [-28, -36, true, 2, 'taxi-black', 'taxi-yellow'], [20, -38, true, 2, 'car-gray', 'car-glass']
];
for (const [x, z, ax, len, body, roof] of VEHICLES) {
  const sx = ax ? len : 1, sz = ax ? 1 : len;
  if (!freeBox(x, z, sx, sz, 2, 6)) continue;
  if (len > 2) { special('brick', x, z, 2, body, { sx, sz }); special('tile', x, z, 5, roof, { sx, sz }); }
  else { special('plate', x, z, 2, body, { sx, sz }); special('tile', x, z, 3, roof, { sx, sz }); }
}

/* ================================================================== 7. packing */
const FAMILY = {
  ...TREE_FAMILY,
  'base': 'ground', 'paving': 'ground', 'sidewalk': 'ground', 'kerb': 'ground', 'asphalt': 'ground', 'lane': 'ground', 'zebra': 'ground',
  'grass': 'ground', 'sablon': 'ground', 'pond': 'ground', 'step': 'ground',
  'glass-green': 'glass', 'glass-blue': 'glass', 'glass-cyan': 'glass', 'glass-red': 'glass', 'glass-orange': 'glass', 'glass-yellow': 'glass',

};
// hidden or textured surfaces: plates (studs on top) are fine
// foliage may show its studs on top of a brick
const STUDS_OK = new Set(['plane', 'plane-light', 'plane-dark', 'cypress']);
const NO_TILE = new Set(['base', 'grass', 'sablon', 'floor', 'plane', 'plane-light', 'plane-dark', 'cypress', 'dove']);
const famId = new Map();
const famOf = m => { const f = FAMILY[MATS[m]] || 'stone'; if (!famId.has(f)) famId.set(f, famId.size + 1); return famId.get(f); };
// hidden or textured surfaces: plates (studs on top) are fine

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
      const ok = ids.every(t => vox[t] && vox[t] !== MAT.reserved && famOf(vox[t]) === f && !occ[t]) && ((vox[idx(i, k, j + 3)] && !slopeFront[idx(i, k, j + 3)]) || STUDS_OK.has(MATS[m])) && !(flags[ids[1]] & FL_HANG) && !(flags[ids[2]] & FL_HANG) && grp[ids[1]] === grp[id] && grp[ids[2]] === grp[id];
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
  const CH = { stone: '#', reserved: 'R', floor: '.', paving: '=', sidewalk: '-', asphalt: ' ', roof: 'r', nat: 'n', 'nat-dark': 'n', 'nat-light': 'n', pas: 'p', glo: 'g', tower: 't', 'tower-light': 't', ceramic: 'c' };
  for (const y of process.env.DEBUG_Y.split(',').map(Number)) {
    console.log(`--- level ${y}`);
    for (let z = Z0; z < Z1; z++) {
      let line = '';
      for (let x = X0; x < X1; x++) { const m = get(x, z, y); line += !m ? '.' : (CH[MATS[m]] || MATS[m][0]); }
      console.log(String(z).padStart(4) + ' ' + line);
    }
  }
}

packAll();
if (process.env.DEBUG_CELL) { const [cx, cz] = process.env.DEBUG_CELL.split(",").map(Number); for (const [n, p] of parts.entries()) { const nb = core.normalizeModel({ version: 2, blocks: [{ id: "p", ...p, step: 1 }] }).blocks[0]; if (cx - X_OFF >= p.x && cx - X_OFF < p.x + nb.sx && cz - Z_OFF >= p.z && cz - Z_OFF < p.z + nb.sz) console.log("part", n, p.shape, p.width + "x" + p.depth, "y", p.y, "h", p.height, p.color, "grounded", grounded[n]); } }
/* ------------------------------------------------------------ report */
const notGrounded = parts.filter((p, i) => !grounded[i]).length;
if (process.env.DEBUG_NG) for (const [n, p] of parts.entries()) if (!grounded[n]) console.log("ng", p.shape, p.width + "x" + p.depth, p.color, "x", p.x + X_OFF, "y", p.y, "z", p.z + Z_OFF);
console.log(`hollowed ${hollowed}, slopes ${slopeCount}, trees ${treeCount}, closure removed ${closureRemoved}`, JSON.stringify(closureBy));
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


/* ================================================================== 8. output */
const COLORS = {
  'base':          { name: 'Base (土台)', hex: '#4a4640' },
  'paving':        { name: 'Plaza Paving (敷地の石畳)', hex: '#c6b99e', roughness: 0.62 },
  'sidewalk':      { name: 'Panot Sidewalk (歩道)', hex: '#a9a49a', roughness: 0.62 },
  'kerb':          { name: 'Kerb (縁石)', hex: '#86827a', roughness: 0.6 },
  'asphalt':       { name: 'Asphalt (車道)', hex: '#3d3f43', roughness: 0.75 },
  'lane':          { name: 'Lane Marking (車線)', hex: '#e6e2d6' },
  'zebra':         { name: 'Zebra Crossing (横断歩道)', hex: '#ebe8de' },
  'grass':         { name: 'Grass (芝生)', hex: '#5e7d3b', roughness: 0.75 },
  'sablon':        { name: 'Sauló Path (砂利の小径)', hex: '#cfb78d', roughness: 0.75 },
  'pond':          { name: 'Pond (ガウディ広場の池)', hex: '#4c86a8', opacity: 0.8, roughness: 0.1 },
  'step':          { name: 'Stone Steps (石段)', hex: '#b7ab93', roughness: 0.6 },
  'floor':         { name: 'Nave Floor (聖堂の床)', hex: '#8d7c66' },
  'stone':         { name: 'Montjuïc Sandstone (モンジュイックの砂岩)', hex: '#c8b28a', roughness: 0.6 },
  'stone-light':   { name: 'Light Sandstone (明るい砂岩)', hex: '#dacbad', roughness: 0.6 },
  'nat':           { name: 'Nativity Stone (生誕の石)', hex: '#a68c67', roughness: 0.66 },
  'nat-dark':      { name: 'Nativity Weathered (生誕の古びた石)', hex: '#7b664b', roughness: 0.7 },
  'nat-light':     { name: 'Nativity Light (生誕の明るい石)', hex: '#bea57e', roughness: 0.66 },
  'pas':           { name: 'Passion Stone (受難の石)', hex: '#d2c9b4', roughness: 0.6 },
  'pas-dark':      { name: 'Passion Shadow (受難の陰)', hex: '#8c8474', roughness: 0.6 },
  'pas-light':     { name: 'Passion Columns (受難の柱)', hex: '#e3dbc8', roughness: 0.55 },
  'glo':           { name: 'Glory Stone (栄光の石)', hex: '#d9cdb2', roughness: 0.6 },
  'glo-dark':      { name: 'Glory Shadow (栄光の陰)', hex: '#7e7563', roughness: 0.6 },
  'glo-light':     { name: 'Glory Columns (栄光の柱)', hex: '#ebe3d0', roughness: 0.55 },
  'tower':         { name: 'Tower Stone (塔の石)', hex: '#cdc4b0', roughness: 0.58 },
  'tower-light':   { name: 'Tower Rib (塔のリブ)', hex: '#e2dbcb', roughness: 0.55 },
  'ceramic':       { name: 'White Glazed Ceramic (白い施釉タイル)', hex: '#f4f2ec', roughness: 0.22 },
  'louver':        { name: 'Bell Louvre (鐘楼の開口)', hex: '#4a3f35' },
  'roof':          { name: 'Stone Roof (石の屋根)', hex: '#a8977b', roughness: 0.62 },
  'roof-ridge':    { name: 'Roof Ridge (棟)', hex: '#8a7b64', roughness: 0.6 },
  'mosaic-red':    { name: 'Venetian Mosaic Red (ベネチアンガラスの赤)', hex: '#b8312c', roughness: 0.25 },
  'mosaic-gold':   { name: 'Venetian Mosaic Gold (ベネチアンガラスの金)', hex: '#d6a53a', roughness: 0.28, metalness: 0.4 },
  'mosaic-white':  { name: 'Venetian Mosaic White (ベネチアンガラスの白)', hex: '#f2eee4', roughness: 0.25 },
  'bronze':        { name: 'Bronze Doors (ブロンズの扉)', hex: '#6b5433', roughness: 0.35, metalness: 0.5 },
  'bronze-green':  { name: 'Nativity Doors (生誕の扉・緑青)', hex: '#56634a', roughness: 0.4, metalness: 0.35 },
  'bone':          { name: 'Bone Columns (骨の柱)', hex: '#e8e1cf', roughness: 0.5 },
  'cypress':       { name: 'Cypress (糸杉)', hex: '#2f5e3e', roughness: 0.4 },
  'dove':          { name: 'Doves (白い鳩)', hex: '#ffffff' },
  'fruit-basket':  { name: 'Fruit Basket (果物の籠)', hex: '#efe9dc' },
  'fruit-orange':  { name: 'Fruit Orange (オレンジ)', hex: '#e2762a', roughness: 0.3 },
  'fruit-red':     { name: 'Fruit Red (さくらんぼ)', hex: '#b8242a', roughness: 0.3 },
  'fruit-yellow':  { name: 'Fruit Yellow (レモン)', hex: '#e8c53a', roughness: 0.3 },
  'fruit-green':   { name: 'Fruit Green (青りんご)', hex: '#6aa13f', roughness: 0.3 },
  'fruit-purple':  { name: 'Fruit Purple (ぶどう)', hex: '#5b2b6e', roughness: 0.3 },
  'cloister':      { name: 'Cloister (回廊)', hex: '#c2ad87', roughness: 0.6 },
  'school-brick':  { name: 'School Brick (付属学校のれんが)', hex: '#b8693f', roughness: 0.6 },
  'school-roof':   { name: 'School Roof (波打つ屋根)', hex: '#9c5533', roughness: 0.6 },
  'school-window': { name: 'School Window (窓)', hex: '#3d3a36' },
  'glass-green':   { name: 'Stained Glass Green (ステンドグラス緑)', hex: '#4fae6d', opacity: 0.72, roughness: 0.12 },
  'glass-blue':    { name: 'Stained Glass Blue (ステンドグラス青)', hex: '#3f74c9', opacity: 0.72, roughness: 0.12 },
  'glass-cyan':    { name: 'Stained Glass Cyan (ステンドグラス水色)', hex: '#5bb7d6', opacity: 0.7, roughness: 0.12 },
  'glass-red':     { name: 'Stained Glass Red (ステンドグラス赤)', hex: '#c8332b', opacity: 0.75, roughness: 0.12 },
  'glass-orange':  { name: 'Stained Glass Orange (ステンドグラス橙)', hex: '#e8782a', opacity: 0.75, roughness: 0.12 },
  'glass-yellow':  { name: 'Stained Glass Yellow (ステンドグラス黄)', hex: '#f2c53d', opacity: 0.75, roughness: 0.12 },
  'crown-glass':   { name: 'Crown Glass (頂部のガラス)', hex: '#dff0f7', opacity: 0.6, roughness: 0.08 },
  'cross-glass':   { name: 'Cross Glass (十字架のガラス)', hex: '#e8f4fa', opacity: 0.6, roughness: 0.08 },
  'star':          { name: 'Star of Mary (マリアの星)', hex: '#fff1bd', opacity: 0.78, roughness: 0.1 },
  'trunk':         { name: 'Plane Tree Trunk (プラタナスの幹)', hex: '#7a6a55' },
  'taxi-black':    { name: 'Taxi Black (タクシーの黒)', hex: '#232427', roughness: 0.3 },
  'taxi-yellow':   { name: 'Taxi Yellow (タクシーの黄)', hex: '#f0c21c', roughness: 0.3 },
  'car-white':     { name: 'Car White (白い車)', hex: '#e9e9e6', roughness: 0.3 },
  'car-gray':      { name: 'Car Gray (灰色の車)', hex: '#8d9096', roughness: 0.3 },
  'car-blue':      { name: 'Car Blue (青い車)', hex: '#2f5a9e', roughness: 0.3 },
  'car-red':       { name: 'Car Red (赤い車)', hex: '#b3282d', roughness: 0.3 },
  'car-glass':     { name: 'Car Glass (車の窓)', hex: '#2c3440', roughness: 0.15 },
  'bus-red':       { name: 'Bus Turístic Red (観光バス)', hex: '#c8202b', roughness: 0.3 },
  'bus-roof':      { name: 'Bus Roof (バスの屋根)', hex: '#f1efe9', roughness: 0.3 },
  'plane':         { name: 'Plane Tree (プラタナス)', hex: '#5d8a3a', roughness: 0.7 },
  'plane-light':   { name: 'Plane Tree Light', hex: '#7ea64c', roughness: 0.7 },
  'plane-dark':    { name: 'Plane Tree Dark', hex: '#46702f', roughness: 0.7 }
};
/* ------------------------------------------------------------ steps */
// Build groups in order; a group is split into bands by height (design plate levels).
const GROUPS = [
  { title: '街区と街路', splits: [], desc: 'アシャンプラ地区の碁盤の目のひと区画（角を斜めに切ったシャンフラ）を土台にします（1スタッド＝2m、1プレート＝0.8m）。まわりはマリーナ通り・サルデーニャ通り・マジョルカ通り・プロベンサ通りの車道と歩道、横断歩道、北東のガウディ広場の芝生と池です。' },
  { title: '身廊と翼廊', splits: [22, 42], desc: 'ラテン十字の平面に、5廊式の身廊（幅48m）と3廊式の翼廊を立ち上げます。側廊の外壁には東側（生誕側）に青と緑、西側（受難側）に赤と橙のステンドグラスをはめ、上部をアーチで閉じます。交差部の四隅には福音書記者の塔を支える太い柱が立ちます。' },
  { title: '後陣', splits: [], desc: '北西の後陣は、7つの礼拝堂が半円に並ぶ周歩廊と、その内側に高くそびえる内陣です。礼拝堂の上には金色の麦の穂をかたどった尖塔が並びます。' },
  { title: '屋根と果物の尖塔', splits: [], desc: '中央身廊と翼廊には45°のスロープで急勾配の切妻屋根をかけ、側廊には2×4スロープの片流れ屋根をかけます。側廊の控え壁には金の麦の穂、高窓の脇にはオレンジ・レモン・ぶどう・さくらんぼなどを盛った「果物のかご」の尖塔が立ちます。' },
  { title: '生誕のファサード', splits: [30, 56, 90], desc: 'ガウディが自ら手がけた北東の生誕のファサード。信仰・希望・慈愛の3つの門は放物線アーチの奥に扉を構え、急な破風には彫刻がびっしりと重なります。中央の慈愛の門の頂には白い鳩がとまる緑の糸杉（生命の樹）。4本の鐘楼（バルナバ・シモン・ユダ・マティア）は四角く立ち上がって途中から円くなり、らせん状の開口を刻みながら細くなって、司教の冠をかたどったベネチアンガラスのモザイクの尖塔で終わります。' },
  { title: '受難のファサード', splits: [30, 56, 90], desc: '南西の受難のファサードは、骨のように簡素で角張った造形です。セコイアの幹のように外へ傾いた6本の柱が大きな庇を支え、その上に彫刻群を納めた横長のフリーズ、さらに18本の骨の柱が並ぶ破風が載ります。鐘楼はヤコブ・トマス・フィリポ・バルトロマイ。' },
  { title: '栄光のファサード', splits: [36, 64, 100], desc: '南東のマジョルカ通りに面する正面、栄光のファサード。7つの秘跡を表す7本の柱の玄関廊の上に16本のランタンが雲のように中央へ高まり、奥には主の祈りの扉が並びます。中央の大きな切妻の奥は身廊の妻壁です。マジョルカ通りの上を越える大階段で向かいの広場へ下ります。鐘楼はアンデレ・ペテロ・パウロ・小ヤコブで、12本の中でいちばん高い塔です。' },
  { title: '福音書記者の4つの塔', splits: [100, 140], desc: '交差部の四隅に立つ高さ135mの4本の塔。頂部は白い施釉タイルの冠に、それぞれの象徴 ── マタイの天使、マルコのライオン、ルカの雄牛、ヨハネの鷲 ── を戴きます。' },
  { title: '聖母マリアの塔', splits: [130], desc: '後陣の上に立つ高さ138mの聖母マリアの塔。白いタイルとガラスの冠の上に、夜には光る12の尖端をもつガラスと鋼の星が輝きます（2021年完成）。' },
  { title: 'イエス・キリストの塔', splits: [100, 150, 185], desc: '交差部の中心にそびえる高さ172.5mの中央塔。完成するとバルセロナでいちばん高い建物になります。放物線状に細くなる塔身は上部で白いタイルとガラスに覆われ、ガラスのランタンの上に、白いタイルとガラスでできた4本の腕をもつ立体の十字架が立ちます。' },
  { title: '回廊・聖具室・付属学校', splits: [], desc: '後陣のまわりを回廊が囲み、北と西の角には放物線状のドームに尖塔を載せた聖具室が立ちます。受難のファサードの脇には、波打つれんがの屋根をもつ付属学校（1909年）。' },
  { title: '街路樹', splits: [], desc: '歩道にプラタナスの並木を植え、広場にも木を添えて完成です。' }
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
  name: 'サグラダ・ファミリア', nameEn: 'Basílica de la Sagrada Família',
  description: '',
  author: 'Claude', prompt: '超リアルな完成後のサグラダ・ファミリア（5000〜15000ピース）', createdAt: '2026-09-25',
  colors: Object.fromEntries(Object.entries(COLORS).filter(([k]) => usedColors.has(k))),
  steps: [], blocks
};
let pruned = 0, moved = 0, dropStuck = 0;
if (process.env.NOORDER) {
  raw.blocks.forEach(b => { b.step = 1; });
  writeFileSync(process.env.NOORDER, JSON.stringify(raw));
  console.log('wrote unordered preview', process.env.NOORDER);
  process.exit(0);
}
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
raw.description = `バルセロナのサグラダ・ファミリアを、完成後の姿で1スタッド＝2m・1プレート＝0.8mに再現。角を斜めに切ったアシャンプラの街区いっぱいに、5廊式の身廊と3廊式の翼廊、7つの礼拝堂が半円に並ぶ後陣のラテン十字を立ち上げ、18本の塔 ── 12使徒の鐘楼、4人の福音書記者の塔、星を戴く聖母マリアの塔、白い十字架が172.5mに達するイエス・キリストの塔 ── をガウディの放物線の輪郭で細くしながら積み上げました。生誕のファサードは彫刻に覆われた3つの門と糸杉、受難のファサードは外へ傾く6本の柱と18本の骨の破風、栄光のファサードは7本の柱の玄関廊と16本のランタン。鐘楼の頂はベネチアンガラスのモザイクの司教冠、窓には東に青と緑、西に赤と橙のステンドグラス、高窓の脇には果物のかごの尖塔。まわりの通りにはプラタナスの並木、黒と黄のタクシーと赤い観光バス。${bx.maxX - bx.minX}×${bx.maxZ - bx.minZ}スタッド・高さ${m.heightPlates}プレート・${m.blocks.length}パーツ。`;
writeFileSync(join(root, 'models/sagrada-familia.json'), core.modelToJSON(core.normalizeModel(raw)));
console.log(`wrote ${m.blocks.length} parts (pruned ${pruned}, dropped ${dropStuck} unorderable, moved ${moved}), ${raw.steps.length} steps, valid: ${fin.allOk}` + (fin.allOk ? '' : ' ' + core.describeIssues(m, fin, 10).join(' | ')));
