// Generates models/sydney-opera-house.json — a large, geometry-accurate Sydney Opera House.
//   node tools/gen-sydney-opera-house.mjs      (then: node tools/validate.mjs && node tools/build.mjs)
//   DEBUG_Y=40,60 node tools/gen-sydney-opera-house.mjs   prints plan-view maps of those plate levels
//
// Scale: 1 stud = 1.25 m, 1 plate = 0.5 m (the LEGO stud : plate ratio), so the highest shell,
// 67 m above the harbour, stands about 134 plates above the water on a 144 × 212 stud base.
//
// Pipeline
//   1. site     — voxels (stud × stud × plate) for the harbour, Bennelong Point, the podium,
//                 the Monumental Steps, the forecourt and the Botanic Garden cliff.
//   2. shells   — every shell is cut from a sphere of radius 75.2 m, as Utzon's "spherical
//                 solution": two mirrored spheres give the pointed-arch section, and a wedge
//                 hinged on the pedestal line gives the sail outline. The union of a hall's
//                 shells (plus the low glazed gaps between them) is hollowed to a skin; skin on
//                 the spheres becomes white / cream tiles, skin on the planes becomes glass.
//   3. pack     — each plate level is covered with real parts, bottom-up, most constrained cell
//                 first: bricks where three levels match, tiles on exposed tops, plates elsewhere;
//                 every part clips onto a stud below (slab plates may hang from the layer above).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = require(join(root, 'js/model-core.js'));
const { PARTS } = core;

/* ------------------------------------------------------------------ scale */
const S = 1.25, P = 0.5;                 // metres per stud / per plate
const SEA = 2;                           // plate level of the harbour surface (top of the water tiles)
const X_OFF = -72, Z_OFF = -104;         // grid index 0 -> stud -72 / -104 (model frame: +X west, +Z north)
const NX = 144, NZ = 212, NY = 142;
const Xm = i => (i + X_OFF + 0.5) * S;   // metres at cell centre (west +)
const Zm = k => (k + Z_OFF + 0.5) * S;   // metres at cell centre (north +)
const Hm = j => (j + 0.5 - SEA) * P;     // metres above the harbour at voxel centre
const yAt = m => SEA + Math.round(m / P); // plate level whose bottom sits at m metres above the harbour
const iOf = x => Math.round(x / S - 0.5) - X_OFF;
const kOf = z => Math.round(z / S - 0.5) - Z_OFF;

const Y_LAND = yAt(3.5);                 // broadwalk, forecourt: 3.5 m
const Y_POD = yAt(14);                   // podium top: 14 m (where the shells stand)

/* ------------------------------------------------------------------ voxels */
const MATS = [null];
const MAT = {};
const mat = k => { if (!(k in MAT)) { MAT[k] = MATS.length; MATS.push(k); } return MAT[k]; };
const vox = new Uint8Array(NX * NZ * NY);
const flags = new Uint8Array(NX * NZ * NY);       // 1 = hang: a plate here may hang from the layer above
const FL_HANG = 1;
const idx = (i, k, j) => (j * NZ + k) * NX + i;
const inGrid = (i, k, j) => i >= 0 && i < NX && k >= 0 && k < NZ && j >= 0 && j < NY;
const get = (i, k, j) => inGrid(i, k, j) ? vox[idx(i, k, j)] : 0;
const set = (i, k, j, m, f = 0) => { if (inGrid(i, k, j)) { vox[idx(i, k, j)] = typeof m === 'string' ? mat(m) : m; flags[idx(i, k, j)] = f; } };
const clear = (i, k, j) => { if (inGrid(i, k, j)) { vox[idx(i, k, j)] = 0; flags[idx(i, k, j)] = 0; } };
const column = (i, k, j0, j1, m, f = 0) => { for (let j = j0; j < j1; j++) set(i, k, j, m, f); };

/* ------------------------------------------------------------------ plan helpers */
function inPoly(x, z, poly) {
  let c = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, za] = poly[a], [xb, zb] = poly[b];
    if ((za > z) !== (zb > z) && x < (xb - xa) * (z - za) / (zb - za) + xa) c = !c;
  }
  return c;
}
/** Chaikin-smoothed closed polygon (rounded corners for the sea wall). */
function smooth(poly, n = 3) {
  let p = poly;
  for (let r = 0; r < n; r++) {
    const q = [];
    for (let a = 0; a < p.length; a++) {
      const [x0, z0] = p[a], [x1, z1] = p[(a + 1) % p.length];
      q.push([0.75 * x0 + 0.25 * x1, 0.75 * z0 + 0.25 * z1], [0.25 * x0 + 0.75 * x1, 0.25 * z0 + 0.75 * z1]);
    }
    p = q;
  }
  return p;
}
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/* ================================================================== site plan (metres) */
// Bennelong Point: the sea wall line. Circular Quay is to the west (+X), Farm Cove to the east.
const POINT = smooth([
  [74, -150], [74, 58], [70, 80], [56, 96], [36, 104], [-34, 104], [-56, 96], [-70, 80], [-74, 58],
  [-74, -70], [-96, -76], [-96, -150]
], 3);
// the podium, with the Bennelong Restaurant platform at the south-west corner
const PODIUM = [[58, -62], [58, 40], [52, 58], [40, 68], [-40, 68], [-52, 58], [-58, 40], [-58, -62]];
const BENNELONG_PAD = { x0: 32, x1: 60, z0: -92, z1: -62 };
const STEPS = { x0: -52, x1: 32, zTop: -62, rows: Y_POD - Y_LAND };          // one tread per plate of rise
const GARDEN = { x1: -66, z1: -96 };                                         // Royal Botanic Garden above the Tarpeian Wall
const Y_GARDEN = yAt(13);

const isLand = (x, z) => inPoly(x, z, POINT);
const isPodium = (x, z) => inPoly(x, z, PODIUM) || (x >= BENNELONG_PAD.x0 && x < BENNELONG_PAD.x1 && z >= BENNELONG_PAD.z0 && z < BENNELONG_PAD.z1);
const stepRow = (x, z) => {                   // 0 = bottom tread ... rows-1 = top tread; -1 = not on the steps
  if (x < STEPS.x0 || x >= STEPS.x1 || z >= STEPS.zTop) return -1;
  const r = STEPS.rows - 1 - Math.floor((STEPS.zTop - z) / S);
  return r >= 0 ? r : -1;
};
const isGarden = (x, z) => x < GARDEN.x1 + (GARDEN.z1 - z) * 0.9 + 3 * Math.sin(z * 0.21) && z < GARDEN.z1 && isLand(x, z);

/* ================================================================== shells */
// Hall frame: u along the hall axis (north +), v across, h above the podium top (metres).
// A shell faces +u' where u' = dir·u. Each half-shell is a patch of a sphere, as in Utzon's
// "spherical solution" (radius close to 75.2 m): the ridge is a circle of radius r in the plane of
// symmetry whose top is the tip, and the sphere of the +v half is centred at v = -d, so the two
// halves meet at the ridge in a pointed arch. In side view the shell is a wedge hinged on its
// pedestal line: from the mouth (angle phiT, up to the tip) back to the ridge's back point.
//   given: pedestal (uP, ±w), mouth angle phiT, tip height hT, ridge radius r, back angle gamma
function solveShell(sh) {
  const phiT = sh.mouth * Math.PI / 180;
  const uT = sh.uP + sh.hT / Math.tan(phiT);
  const uc = uT, hc = sh.hT - sh.r;                          // tip = top of the ridge circle
  const g = sh.back * Math.PI / 180;
  const uB = uc - sh.r * Math.sin(g), hB = hc + sh.r * Math.cos(g);
  const d = (sh.r ** 2 - hc ** 2 - (sh.uP - uc) ** 2 - sh.w ** 2) / (2 * sh.w);   // sphere through the pedestal
  if (!(d > 0)) throw new Error(`shell ${sh.name}: pedestal outside the ridge sphere`);
  const R = Math.hypot(sh.r, d);
  return { ...sh, uT, uB, hB, uc, hc, d, R, phiT, phiB: Math.atan2(hB, uB - sh.uP) };
}
const HALLS = [
  // Concert Hall (west): three shells open to the harbour, one faces the steps
  { name: 'concert', label: 'コンサートホール', X0: 26, Z0: 10, yaw: 3.5, shells: [
    { name: 'A1', dir: 1, uP: 34, w: 18, mouth: 54, hT: 39, r: 46, back: 60 },
    { name: 'A2', dir: 1, uP: 11, w: 20.5, mouth: 56, hT: 49, r: 52, back: 58 },
    { name: 'A3', dir: 1, uP: -14, w: 21.5, mouth: 58, hT: 54, r: 56, back: 62 },
    { name: 'A4', dir: -1, uP: 38, w: 17, mouth: 55, hT: 34, r: 44, back: 64 }   // faces south (u' = -u)
  ] },
  // Joan Sutherland Theatre (east): the same family of shells, about 8 % smaller
  { name: 'theatre', label: 'ジョーン・サザーランド劇場', X0: -25, Z0: 12, yaw: -3.5, shells: [
    { name: 'B1', dir: 1, uP: 31, w: 16.5, mouth: 54, hT: 36, r: 42, back: 60 },
    { name: 'B2', dir: 1, uP: 10, w: 19, mouth: 56, hT: 45, r: 48, back: 58 },
    { name: 'B3', dir: 1, uP: -13, w: 20, mouth: 58, hT: 50, r: 52, back: 62 },
    { name: 'B4', dir: -1, uP: 35, w: 15.5, mouth: 55, hT: 31, r: 40, back: 64 }
  ] },
  // Bennelong restaurant: a small group at the south-west corner, opening toward the city
  { name: 'bennelong', label: 'ベネロング', X0: 46, Z0: -77, yaw: 0, shells: [
    { name: 'C1', dir: -1, uP: 5, w: 8, mouth: 55, hT: 15, r: 18, back: 60 },
    { name: 'C2', dir: -1, uP: -4, w: 9.5, mouth: 57, hT: 20, r: 22, back: 58 },
    { name: 'C3', dir: 1, uP: 12, w: 7, mouth: 55, hT: 12, r: 15, back: 64 }
  ] }
].map(h => ({ ...h, yawR: h.yaw * Math.PI / 180, shells: h.shells.map(solveShell) }));

/** Hall-frame coordinates of a model point (metres). */
function toHall(hall, X, Z) {
  const dx = X - hall.X0, dz = Z - hall.Z0, s = Math.sin(hall.yawR), c = Math.cos(hall.yawR);
  return [dx * s + dz * c, dx * c - dz * s];
}
/** Depth below the sphere surface (> 0 inside the lens), for a shell-frame point. */
const lensDepth = (sh, u, v, h) => sh.R - Math.hypot(u - sh.uc, Math.abs(v) + sh.d, h - sh.hc);
const sectorAngle = (sh, u, h) => Math.atan2(h, u - sh.uP);
const inSector = (sh, u, h) => { const a = sectorAngle(sh, u, h); return a >= sh.phiT && a <= sh.phiB; };
// where a mouth is open to the air, its glass is set back behind the shell's edge by GLASS_SET metres
const GLASS_SET = 1.4, SHELL_T = 1.6;
function shellHit(sh, u, v, h) {
  const up = sh.dir * u;
  if (h < 0) return null;
  const dep = lensDepth(sh, up, v, h);
  if (dep < 0 || !inSector(sh, up, h)) return null;
  const rho = Math.hypot(up - sh.uP, h), phi = sectorAngle(sh, up, h);
  return { dep, set: (phi - sh.phiT) * rho, rho, phi };
}
/** Rays of a shell in the hall's side plane (u north): its north and south boundary rays. */
function rays(sh) {
  const toward = (uX, hX) => [sh.dir * (uX - sh.uP), hX];
  const mouth = toward(sh.uT, sh.hT), back = toward(sh.uB, sh.hB);
  return sh.dir > 0 ? { north: mouth, south: back } : { north: back, south: mouth };
}
const footU = sh => sh.dir * sh.uP;
/** Low glazed gap between two neighbouring shells (north shell a, south shell b). */
function inGap(a, b, u, v, h) {
  if (h < 0) return false;
  const ra = rays(a).south, rb = rays(b).north, fa = footU(a), fb = footU(b);
  const ca = ra[0] * h - ra[1] * (u - fa);        // > 0: south of a's south ray
  const cb = rb[0] * h - rb[1] * (u - fb);        // < 0: north of b's north ray
  if (!(ca > 0 && cb < 0)) return false;
  return lensDepth(a, a.dir * u, v, h) > 0 || lensDepth(b, b.dir * u, v, h) > 0;
}
/** Is a hall-frame point inside the hall's volume (any shell wedge, or a gap)? */
function inHall(hall, u, v, h) {
  if (hall.shells.some(sh => shellHit(sh, u, v, h))) return true;
  for (let s = 0; s + 1 < hall.order.length; s++) if (inGap(hall.order[s], hall.order[s + 1], u, v, h)) return true;
  return false;
}
for (const hall of HALLS) {
  hall.order = [...hall.shells].sort((a, b) => footU(b) - footU(a));   // north to south
  for (const sh of hall.shells) console.log(`${sh.name}: R=${sh.R.toFixed(1)} d=${sh.d.toFixed(1)} tip u=${(sh.dir * sh.uT).toFixed(1)} back u=${(sh.dir * sh.uB).toFixed(1)} h=${sh.hB.toFixed(1)}`);
}

/* ================================================================== 1. site */
// base plate everywhere
for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) set(i, k, 0, 'base');

const landCell = [], podCell = [];
for (let i = 0; i < NX; i++) { landCell[i] = []; podCell[i] = []; for (let k = 0; k < NZ; k++) { landCell[i][k] = isLand(Xm(i), Zm(k)); podCell[i][k] = landCell[i][k] && isPodium(Xm(i), Zm(k)); } }
const isLandC = (i, k) => i >= 0 && i < NX && k >= 0 && k < NZ && landCell[i][k];
const isPodC = (i, k) => i >= 0 && i < NX && k >= 0 && k < NZ && podCell[i][k];

// harbour: water tiles, a deeper tone away from the shore
const shoreDist = new Map();
{
  const q = [];
  for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) if (landCell[i][k]) { shoreDist.set(i * 1000 + k, 0); q.push([i, k]); }
  for (let h = 0; h < q.length; h++) {
    const [i, k] = q[h], d = shoreDist.get(i * 1000 + k);
    if (d >= 30) continue;
    for (const [di, dk] of N4) { const a = i + di, b = k + dk; if (a < 0 || a >= NX || b < 0 || b >= NZ || shoreDist.has(a * 1000 + b)) continue; shoreDist.set(a * 1000 + b, d + 1); q.push([a, b]); }
  }
}
for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) {
  if (landCell[i][k]) continue;
  const d = shoreDist.get(i * 1000 + k) ?? 99;
  const n = Math.sin(i * 0.37 + k * 0.11) + Math.sin(k * 0.29 - i * 0.07);
  set(i, k, 1, d <= 1 ? 'harbour-edge' : d + n * 2 > 16 ? 'harbour-deep' : 'harbour');
}

// land: sea wall ring, support piers and a two-plate slab under the paving
// (the edge of the base, where the land is cut off, is walled the same way)
const Y_SLAB = Y_LAND - 2;
const onBoundary = (i, k) => i === 0 || k === 0 || i === NX - 1 || k === NZ - 1;
for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) {
  if (!landCell[i][k] || podCell[i][k]) continue;       // the podium stands straight on the base plate
  const x = Xm(i), z = Zm(k);
  const edge = onBoundary(i, k) || N8.some(([di, dk]) => !isLandC(i + di, k + dk));
  if (edge) { column(i, k, 1, Y_LAND - 1, (i * 5 + k * 3) % 7 === 0 ? 'seawall-dark' : 'seawall'); set(i, k, Y_LAND - 1, 'seawall-cap'); continue; }
  if ((i % 6 < 2) && (k % 6 < 2)) column(i, k, 1, Y_SLAB, 'fill');
  set(i, k, Y_SLAB, 'fill', FL_HANG);
  const sr = stepRow(x, z);
  set(i, k, Y_SLAB + 1, sr >= 0 ? 'steps' : z < -64 && x < 56 ? 'forecourt' : 'broadwalk');
}

// podium: granite walls, piers, a three-plate slab; the lower broadwalk level shows a band of
// dark glazing (foyers, restaurants and bars under the podium) between granite piers
const podEdge = (i, k) => N8.some(([di, dk]) => !isPodC(i + di, k + dk));
for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) {
  if (!podCell[i][k]) continue;
  const x = Xm(i), z = Zm(k);
  if (podEdge(i, k)) {
    const outward = N4.filter(([di, dk]) => !isPodC(i + di, k + dk));
    const alongZ = outward.some(([di]) => di !== 0);
    const run = alongZ ? k : i;
    const glazed = (x > 40 && z > -60 && z < 38) || z > 50 || (x < -40 && z > -30 && z < 38);
    for (let j = 1; j < Y_POD - 1; j++) {
      let m = j < Y_LAND ? 'podium-base' : 'granite';
      if (glazed && j >= Y_LAND && j < Y_LAND + 7 && run % 4 !== 0) m = 'window';
      if (j === Y_LAND + 7 || j === Y_POD - 2) m = 'granite-band';
      set(i, k, j, m);
    }
    set(i, k, Y_POD - 1, 'podium-edge');
    continue;
  }
  if ((i % 8 < 2) && (k % 8 < 2)) column(i, k, 1, Y_POD - 3, 'podium-core');
  set(i, k, Y_POD - 3, 'podium-core', FL_HANG);
  set(i, k, Y_POD - 2, 'podium-core');
  set(i, k, Y_POD - 1, 'podium-top');
}
// Monumental Steps: solid treads of granite, one plate per tread
for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) {
  const x = Xm(i), z = Zm(k), r = stepRow(x, z);
  if (r < 0 || podCell[i][k] || !landCell[i][k]) continue;
  column(i, k, Y_LAND, Y_LAND + r + 1, 'steps');
  // cheek walls at both ends of the flight
  if (i === iOf(STEPS.x0) || i === iOf(STEPS.x1 - S)) { column(i, k, Y_LAND, Y_LAND + r + 1, 'granite'); set(i, k, Y_LAND + r + 1, 'granite-band'); }
}
// Royal Botanic Garden above the sandstone Tarpeian Wall
for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) {
  const x = Xm(i), z = Zm(k);
  if (!isGarden(x, z)) continue;
  const edge = onBoundary(i, k) || N8.some(([di, dk]) => !isGarden(Xm(i + di), Zm(k + dk)));
  if (edge) {
    for (let j = Y_LAND; j < Y_GARDEN - 1; j++) set(i, k, j, (j * 7 + i * 3 + k * 5) % 13 < 4 ? 'sandstone-dark' : 'sandstone');
    set(i, k, Y_GARDEN - 1, 'hedge');
    continue;
  }
  if ((i % 6 < 2) && (k % 6 < 2)) column(i, k, Y_LAND, Y_GARDEN - 2, 'fill');
  set(i, k, Y_GARDEN - 2, 'fill', FL_HANG);
  const n = Math.sin(i * 0.9) * Math.cos(k * 0.7) + Math.sin((i + k) * 0.31);
  set(i, k, Y_GARDEN - 1, n > 0.9 ? 'grass-dark' : n < -1.1 ? 'grass-light' : 'grass');
}
// trees: Moreton Bay figs in the garden (a trunk and a rounded canopy)
function tree(ci, ck, j0, rH, rV, trunkH) {
  for (let j = j0; j < j0 + trunkH; j++) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(ci + a, ck + b, j, 'trunk');
  const cy = j0 + trunkH + rV - 1;
  for (let j = j0 + trunkH; j <= cy + rV; j++) for (let di = -Math.ceil(rH); di <= Math.ceil(rH) + 1; di++) for (let dk = -Math.ceil(rH); dk <= Math.ceil(rH) + 1; dk++) {
    const dx = di - 0.5, dz = dk - 0.5, dy = (j - cy) / rV;
    if ((dx * dx + dz * dz) / (rH * rH) + dy * dy > 1) continue;
    const n = Math.sin((ci + di) * 1.7 + j * 0.9) + Math.cos((ck + dk) * 1.3 - j * 0.5);
    set(ci + di, ck + dk, j, n > 1.1 ? 'tree-light' : n < -0.9 ? 'tree-dark' : 'tree');
  }
}
const TREES = [];
for (let k = 2; k < NZ; k += 7) for (let i = 2; i < NX; i += 7) {
  const x = Xm(i) + ((k * 7) % 5) - 2, z = Zm(k) + ((i * 3) % 5) - 2;
  const ii = iOf(x), kk = kOf(z);
  const clear = [[-3, -3], [4, -3], [-3, 4], [4, 4], [0, 0]].every(([a, b]) => isGarden(Xm(ii + a), Zm(kk + b)) && !onBoundary(ii + a, kk + b));
  if (clear) TREES.push([ii, kk]);
}
for (const [n, [ti, tk]] of TREES.entries()) tree(ti, tk, Y_GARDEN, 3.2 + (n % 3) * 0.5, 4 + (n % 2), 4 + (n % 3));

// the harbour: a First Fleet class ferry (green hull, cream decks, a wheelhouse at each end)
const FERRY = { i0: iOf(-26), k0: kOf(114), L: 22, W: 6 };
{
  const { i0, k0, L, W } = FERRY;
  const inHull = (a, b, shrink) => { const u = (a + 0.5) / L * 2 - 1, v = (b + 0.5) / W * 2 - 1; return u * u * u * u + v * v <= 1 - shrink; };
  for (let a = 0; a < L; a++) for (let b = 0; b < W; b++) {
    const i = i0 + a, k = k0 + b;
    if (!inHull(a, b, 0)) continue;
    const edge = !inHull(a - 1, b, 0) || !inHull(a + 1, b, 0) || !inHull(a, b - 1, 0) || !inHull(a, b + 1, 0);
    column(i, k, 1, 4, 'ferry-hull');
    set(i, k, 4, edge ? 'ferry-trim' : 'ferry-deck');
    const inCabin = a >= 3 && a < L - 3 && b >= 1 && b < W - 1;
    if (inCabin) {
      const cEdge = a === 3 || a === L - 4 || b === 1 || b === W - 2;
      for (let j = 5; j < 9; j++) set(i, k, j, cEdge && (j === 6 || j === 7) && (a + b) % 2 === 0 ? 'ferry-window' : 'ferry-cream');
      set(i, k, 9, 'ferry-trim');
      if ((a === 5 || a === L - 6) && b >= 2 && b < W - 2) for (let j = 10; j < 13; j++) set(i, k, j, j === 11 ? 'ferry-window' : 'ferry-cream');
      if ((a === 5 || a === L - 6) && b >= 2 && b < W - 2) set(i, k, 13, 'ferry-trim');
      if (a >= 10 && a < 12 && b >= 2 && b < 4) { for (let j = 10; j < 14; j++) set(i, k, j, 'ferry-funnel'); set(i, k, 14, 'ferry-trim'); }
    }
  }
  // wake: white water behind the ferry (heading west)
  for (let a = -9; a < 0; a++) for (let b = 0; b < W; b++) {
    const i = i0 + a, k = k0 + b, spread = -a * 0.35;
    const off = Math.abs(b - (W - 1) / 2);
    if (off <= 0.5 + spread && off >= spread - 1 && get(i, k, 1)) set(i, k, 1, 'foam');
  }
}

// street furniture: lamp posts along the sea wall and the Opera Bar umbrellas on the lower
// concourse. These are special parts (round bricks / round plates) added after packing; the
// voxels are reserved so the paving under them gets studs.
const SPECIALS = [];
const reserve = (i, k, j0, j1) => { for (let j = j0; j < j1; j++) set(i, k, j, 'reserved'); };
{
  const landDist = new Map(), q = [];
  for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) if (landCell[i][k] && N4.some(([a, b]) => !isLandC(i + a, k + b))) { landDist.set(i * 1000 + k, 0); q.push([i, k]); }
  for (let h = 0; h < q.length; h++) { const [i, k] = q[h], d = landDist.get(i * 1000 + k); if (d >= 3) continue; for (const [a, b] of N4) { const ii = i + a, kk = k + b; if (!isLandC(ii, kk) || landDist.has(ii * 1000 + kk)) continue; landDist.set(ii * 1000 + kk, d + 1); q.push([ii, kk]); } }
  const lamps = [];
  for (const [key, d] of landDist) {
    if (d !== 2) continue;
    const i = Math.floor(key / 1000), k = key % 1000, x = Xm(i), z = Zm(k);
    if (podCell[i][k] || isGarden(x, z) || stepRow(x, z) >= 0 || onBoundary(i, k) || z < -120) continue;
    if (get(i, k, Y_LAND) || get(i, k, Y_LAND - 1) === 0) continue;
    if (lamps.some(([a, b]) => Math.abs(a - i) + Math.abs(b - k) < 12)) continue;
    lamps.push([i, k]);
  }
  for (const [i, k] of lamps) {
    reserve(i, k, Y_LAND, Y_LAND + 8);
    for (let n = 0; n < 2; n++) SPECIALS.push(['round-brick', 1, 1, i, Y_LAND + 3 * n, k, 'lamp-post']);
    SPECIALS.push(['round-plate', 1, 1, i, Y_LAND + 6, k, 'lamp-post']);
    SPECIALS.push(['round-tile', 1, 1, i, Y_LAND + 7, k, 'lamp-light']);
  }
  // Opera Bar: white umbrellas and tables on the western broadwalk, south of the podium's glazing
  for (let z = -56; z <= -30; z += 6.5) for (let x = 62; x <= 70; x += 5) {
    const i = iOf(x), k = kOf(z);
    if (!isLandC(i, k) || podCell[i][k] || !isLandC(i + 1, k + 1)) continue;
    reserve(i, k, Y_LAND, Y_LAND + 6);
    for (const [a, b] of [[1, 0], [0, 1], [1, 1]]) reserve(i + a, k + b, Y_LAND + 6, Y_LAND + 8);
    reserve(i, k, Y_LAND + 6, Y_LAND + 8);
    SPECIALS.push(['round-brick', 1, 1, i, Y_LAND, k, 'umbrella']);
    SPECIALS.push(['round-brick', 1, 1, i, Y_LAND + 3, k, 'umbrella']);
    SPECIALS.push(['round-plate', 2, 2, i, Y_LAND + 6, k, 'umbrella']);
    SPECIALS.push(['round-tile', 2, 2, i, Y_LAND + 7, k, 'umbrella']);
  }
}

/* ================================================================== 2. shells */
// voxelize each hall: V = union of shell wedges and the low gaps between them; keep a skin
const Y_TOP = NY - 1;
const insideV = new Uint8Array(NX * NZ * NY);   // 1 = inside a hall (skin or hollow)
const shellInfo = new Map();                    // voxel -> { sh, hit, exposed, exposedSphere }
const glassHall = new Map();                    // glass voxel -> hall
for (const hall of HALLS) {
  let i0 = NX, i1 = 0, k0 = NZ, k1 = 0;
  const hits = new Map();
  for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) {
    const [u, v] = toHall(hall, Xm(i), Zm(k));
    if (Math.abs(v) > 40 || Math.abs(u) > 90) continue;
    for (let j = Y_POD; j < Y_TOP; j++) {
      const h = (j + 0.5 - Y_POD) * P;
      let best = null;
      for (const sh of hall.shells) {
        const hit = shellHit(sh, u, v, h);
        if (hit && (!best || hit.dep < best.hit.dep)) best = { sh, hit };
      }
      let isIn = !!best;
      if (!isIn) for (let s = 0; s + 1 < hall.order.length && !isIn; s++) if (inGap(hall.order[s], hall.order[s + 1], u, v, h)) isIn = true;
      if (!isIn) continue;
      if (best && best.hit.dep > SHELL_T && best.hit.set < GLASS_SET) {
        // just behind a mouth: carve the recess if the air is right in front of it
        const sh = best.sh, a = sh.phiT - 0.6 / best.hit.rho;
        const uf = sh.dir * (sh.uP + best.hit.rho * Math.cos(a)), hf = best.hit.rho * Math.sin(a);
        if (!inHall(hall, uf, v, hf)) continue;
      }
      insideV[idx(i, k, j)] = 1;
      if (best) hits.set(idx(i, k, j), best);
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); k0 = Math.min(k0, k); k1 = Math.max(k1, k);
    }
  }
  hall.box = { i0, i1, k0, k1 };
  const inV = (i, k, j) => j < Y_POD ? true : inGrid(i, k, j) && insideV[idx(i, k, j)] === 1;
  let nShell = 0, nGlass = 0;
  for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) for (let j = Y_POD; j < Y_TOP; j++) {
    const id = idx(i, k, j);
    if (!insideV[id] || vox[id]) continue;
    let skin = false, exposedSphere = false, exposed = false;
    for (let dj = -1; dj <= 1 && !skin; dj++) for (const [di, dk] of [[0, 0], ...N8]) {
      if (!inV(i + di, k + dk, j + dj)) { skin = true; break; }
    }
    if (!skin) continue;
    const best = hits.get(id);
    // directly exposed faces: is any open face outside the sphere (the tiled skin)?
    for (const [di, dk, dj] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (inV(i + di, k + dk, j + dj)) continue;
      exposed = true;
      if (best) {
        const [u, v] = toHall(hall, Xm(i + di), Zm(k + dk));
        const h = (j + dj + 0.5 - Y_POD) * P;
        if (lensDepth(best.sh, best.sh.dir * u, v, h) < 0) exposedSphere = true;
      }
    }
    if (best && best.hit.dep <= SHELL_T + 0.9) {
      shellInfo.set(id, { hall, sh: best.sh, hit: best.hit, exposed, exposedSphere });
      vox[id] = mat('shell-core');
      nShell++;
    } else {
      vox[id] = mat('glass');
      glassHall.set(id, hall);
      nGlass++;
    }
  }
  console.log(`${hall.name}: shell voxels ${nShell}, glass voxels ${nGlass}`);
}

// colours of the shells: glossy white tiles with cream "lids" along ribs that fan out from each
// pedestal; the exposed underside and the edge beams show the ribbed concrete
for (const [id, s] of shellInfo) {
  const { sh, hit, exposed, exposedSphere } = s;
  let m = 'shell-core';
  if (exposed && !exposedSphere) m = 'concrete';
  else if (exposedSphere) {
    const span = sh.phiB - sh.phiT, nRib = Math.max(4, Math.round(span * Math.max(sh.hT, 12) / 7.5));
    const f = (hit.phi - sh.phiT) / span * nRib;
    const off = Math.abs(f - Math.round(f)) * span / nRib * hit.rho;       // metres from the nearest rib
    m = off < 0.62 && hit.rho > 4 ? 'tile-cream' : 'tile-white';
  }
  vox[id] = mat(m);
}
// glass: bronze mullions every 4 studs across each mouth, a transom every 3.5 m, a sill on the podium
for (const [id, hall] of glassHall) {
  const i = id % NX, k = Math.floor(id / NX) % NZ, j = Math.floor(id / (NX * NZ));
  const [, v] = toHall(hall, Xm(i), Zm(k));
  if (Math.abs(Math.round(v / S)) % 4 === 2 || (j - Y_POD) % 7 === 0) vox[id] = mat('mullion');
}

/* ================================================================== interiors */
// Simple interiors for the layer (cross-section) view and the glimpses through the glass: the
// auditorium walls of brush-box timber, raked stalls, the stage, the Grand Organ of the Concert
// Hall and the fly tower of the Joan Sutherland Theatre. Everything keeps clear of the shells.
const clearIn = new Uint8Array(NX * NZ * NY);
for (const hall of HALLS) {
  const { i0, i1, k0, k1 } = hall.box;
  for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) for (let j = Y_POD; j < Y_TOP; j++) {
    if (!insideV[idx(i, k, j)] || vox[idx(i, k, j)]) continue;
    let ok = true;
    for (let dj = -3; dj <= 3 && ok; dj++) for (let di = -2; di <= 2 && ok; di++) for (let dk = -2; dk <= 2 && ok; dk++) {
      const a = i + di, b = k + dk, c = j + dj;
      if (c < Y_POD) continue;
      if (!inGrid(a, b, c) || !insideV[idx(a, b, c)] || vox[idx(a, b, c)]) ok = false;
    }
    if (ok) clearIn[idx(i, k, j)] = 1;
  }
}
if (process.env.DEBUG_CLEAR) for (const hall of HALLS.slice(0, 2)) {
  for (const vv of [0, 8, 14]) {
    let line = `${hall.name} v=${vv}: `;
    for (let uu = -60; uu <= 60; uu += 4) {
      const X = hall.X0 + uu * Math.sin(hall.yawR) + vv * Math.cos(hall.yawR), Z = hall.Z0 + uu * Math.cos(hall.yawR) - vv * Math.sin(hall.yawR);
      const i = iOf(X), k = kOf(Z);
      let lo = -1, hi = -1;
      for (let j = Y_POD; j < Y_TOP; j++) if (clearIn[idx(i, k, j)]) { if (lo < 0) lo = j - Y_POD; hi = j - Y_POD; }
      line += `${uu}:${lo < 0 ? '-' : (lo * P) + '-' + (hi * P)} `;
    }
    console.log(line);
  }
}
function furnish(hall, fn) {
  const { i0, i1, k0, k1 } = hall.box;
  for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
    const [u, v] = toHall(hall, Xm(i), Zm(k));
    for (let j = Y_POD; j < Y_TOP; j++) {
      if (!clearIn[idx(i, k, j)]) continue;
      const m = fn(u, v, (j - Y_POD) * P, j - Y_POD, i, k);
      if (m) set(i, k, j, m);
    }
  }
}
const inBox = (u, v, u0, u1, hw) => u >= u0 && u < u1 && Math.abs(v) < hw;
const onRim = (u, v, u0, u1, hw) => inBox(u, v, u0, u1, hw) && !inBox(u, v, u0 + S, u1 - S, hw - S);
{
  // Concert Hall: raked stalls rising to the south, the stage, and the Grand Organ behind it
  const hall = HALLS.find(h => h.name === 'concert');
  furnish(hall, (u, v, h, n) => {
    if (u >= 1 && u < 12 && Math.abs(v) < 11 && n < 3) return n === 2 ? 'stage' : 'wood-dark';
    if (u >= 12 && u < 15 && Math.abs(v) < 11 && n < 8) return n === 7 ? 'stage' : 'wood-dark';           // organ gallery
    if (u >= -24 && u < 1 && Math.abs(v) < 14.5) {
      const top = 2 + Math.floor((1 - u) / 2.5);                                                          // one plate per row
      if (n < top) return n === top - 1 ? ((Math.floor((1 - u) / 1.25) % 2) ? 'seat-wood' : 'wood') : 'wood-dark';
    }
    return null;
  });
  // the Grand Organ (10,154 pipes): round-brick pipes in a row on the gallery, tallest in the middle
  for (let i = hall.box.i0; i <= hall.box.i1; i++) for (let k = hall.box.k0; k <= hall.box.k1; k++) {
    const [u, v] = toHall(hall, Xm(i), Zm(k));
    if (u < 13.5 || u >= 14.75 || Math.abs(v) > 9.5) continue;
    const bricks = 4 + Math.round(4 * Math.cos(v / 10 * Math.PI / 2)) - (Math.abs(Math.round(v / S)) % 2);
    const j0 = Y_POD + 8;
    let ok = get(i, k, j0 - 1) !== 0;
    for (let j = j0; j < j0 + bricks * 3 && ok; j++) if (!clearIn[idx(i, k, j)] || vox[idx(i, k, j)]) ok = false;
    if (!ok) continue;
    for (let j = j0; j < j0 + bricks * 3; j++) set(i, k, j, 'reserved');
    for (let b = 0; b < bricks; b++) SPECIALS.push(['round-brick', 1, 1, i, j0 + 3 * b, k, 'organ']);
  }
}
{
  // Joan Sutherland Theatre: stage and fly tower at the south, red stalls rising to the north
  const hall = HALLS.find(h => h.name === 'theatre');
  furnish(hall, (u, v, h, n) => {
    if (u >= -21 && u < -9 && Math.abs(v) < 7.5 && (u < -19.75 || Math.abs(v) >= 6.25) && n >= 3) return 'flytower';
    if (u >= -9 && u < -7.75 && Math.abs(v) < 12 && (Math.abs(v) > 6.5 || h > 8.5)) return 'proscenium';
    if (u >= -22 && u < -7.75 && Math.abs(v) < 11 && n < 3) return n === 2 ? 'stage' : 'wood-dark';
    if (u >= -6 && u < 22 && Math.abs(v) < 13) {
      const top = 2 + Math.floor((u + 6) / 2.5);
      if (n < top) return n === top - 1 ? ((Math.floor((u + 6) / 1.25) % 2) ? 'seat-red' : 'wood') : 'wood-dark';
    }
    return null;
  });
}

/* ================================================================== 3. packing */
// families: parts are one colour, but voxels hidden inside the skin take any colour of their family
const FAMILY = { 'tile-white': 'shell', 'tile-cream': 'shell', 'concrete': 'shell', 'shell-core': 'shell', 'glass': 'glass', 'mullion': 'glass',
  'tree': 'tree', 'tree-dark': 'tree', 'tree-light': 'tree', 'grass': 'grass', 'grass-dark': 'grass', 'grass-light': 'grass', 'podium-top': 'podtop', 'podium-joint': 'podtop' };
const famId = new Map();
const famOf = m => { const f = FAMILY[MATS[m]] || MATS[m]; if (!famId.has(f)) famId.set(f, famId.size + 1); return famId.get(f); };
const NO_TILE = new Set(['base', 'fill', 'podium-core', 'shell-core']);   // hidden surfaces: plates are fine

/** Closure: every voxel must be able to clip onto a stud below — directly, or through a straight
 *  run of its family that one part can span. Otherwise fill the voxel below with a hidden one
 *  (only inside a hall), or give the voxel up. */
let closureFilled = 0, closureRemoved = 0;
const closureBy = {};
{
  const filled = (i, k, j) => get(i, k, j) !== 0;
  const direct = (i, k, j) => j === 0 || filled(i, k, j - 1);
  const runOK = (i, k, j) => {
    if (direct(i, k, j)) return true;
    if ((flags[idx(i, k, j)] & FL_HANG) && filled(i, k, j + 1)) return true;
    const f = famOf(get(i, k, j));
    for (const [di, dk] of N4) for (let t = 1; t < 8; t++) {
      const a = i + di * t, b = k + dk * t, m = get(a, b, j);
      if (!m || famOf(m) !== f) break;
      if (direct(a, b, j)) return true;
    }
    return false;
  };
  const tryFill = (i, k, j, m, depth) => {
    if (depth > 6 || j <= Y_POD || !inGrid(i, k, j) || get(i, k, j) || !insideV[idx(i, k, j)]) return false;
    vox[idx(i, k, j)] = m;
    if (runOK(i, k, j) || tryFill(i, k, j - 1, m, depth + 1)) { closureFilled++; return true; }
    vox[idx(i, k, j)] = 0;
    return false;
  };
  for (let j = 1; j < NY; j++) for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
    const m = get(i, k, j);
    if (!m || m === MAT.reserved || runOK(i, k, j)) continue;
    const fm = FAMILY[MATS[m]] === 'glass' ? mat('glass') : mat('shell-core');
    if (tryFill(i, k, j - 1, fm, 0)) continue;
    closureBy[MATS[m]] = (closureBy[MATS[m]] || 0) + 1;
    clear(i, k, j); closureRemoved++;
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
    if (!inGrid(a, b, c) || !vox[idx(a, b, c)]) { open = true; break; }
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
  const pi = parts.length;
  const below = new Set();
  for (let a = 0; a < sx; a++) for (let c = 0; c < sz; c++) for (let t = 0; t < height; t++) {
    const id = idx(i + a, k + c, j + t);
    if (occ[id]) throw new Error(`collision: ${shape} ${sx}x${sz} at ${i},${j},${k}`);
    occ[id] = 1;
  }
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
    const exposed = !vox[idx(i, k, j + 1)] || j + 1 >= NY;
    const col = hidden[id] ? WILD : m;
    let brickCol = null;
    if (!exposed && j + 3 < NY) {
      const ids = [id, idx(i, k, j + 1), idx(i, k, j + 2)];
      const ok = ids.every(t => vox[t] && famOf(vox[t]) === f && !occ[t]) && vox[idx(i, k, j + 3)] && !(flags[ids[1]] & FL_HANG) && !(flags[ids[2]] & FL_HANG);
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
          if (shape === 'tile' && !ci.exposed) { ok = false; break; }
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
    for (const kk of [...region]) if (!covered.has(kk)) region.add(kk);
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

/** Pack every level bottom-up. Large levels are cut into bays that shift every level. */
let hung = 0;
function packAll(j0 = 0, j1 = NY) {
  for (let j = j0; j < j1; j++) {
    const cells = [];
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) { const m = vox[idx(i, k, j)]; if (m && m !== MAT.reserved && !occ[idx(i, k, j)]) cells.push([i, k]); }
    if (!cells.length) continue;
    let left = [];
    if (cells.length > 5000) {
      const T = 24, off = (j * 5) % 24;         // consecutive levels never share a seam
      const bays = new Map();
      for (const c of cells) { const t = Math.floor((c[0] + off) / T) + ',' + Math.floor((c[1] + off) / T); if (!bays.has(t)) bays.set(t, []); bays.get(t).push(c); }
      for (const bay of bays.values()) left.push(...packLevel(j, bay));
      if (left.length) left = packLevel(j, left);            // across bay seams
    } else left = packLevel(j, cells);
    // parts placed above ungrounded hanging plates ground them: later passes can use those studs
    for (let pass = 0; pass < 3 && left.length; pass++) { const n = left.length; left = packLevel(j, left); if (left.length === n) break; }
    // last resort: a plate hung under the part above (it is grounded through that part)
    if (left.length) {
      const hangers = left.filter(([i, k]) => vox[idx(i, k, j + 1)] && !occ[idx(i, k, j + 1)]);
      for (const [i, k] of hangers) flags[idx(i, k, j)] |= FL_HANG;
      if (hangers.length) { const rest = packLevel(j, hangers); hung += hangers.length - rest.length; left = left.filter(c => !hangers.includes(c)).concat(rest); }
    }
    for (const [i, k] of left) { dropped.push({ i, k, j, m: MATS[vox[idx(i, k, j)]] }); vox[idx(i, k, j)] = 0; }
  }
}
packAll();
for (const [shape, sx, sz, i, j, k, color] of SPECIALS) { for (let a = 0; a < sx; a++) for (let b = 0; b < sz; b++) vox[idx(i + a, k + b, j)] = 0; addPart(shape, sx, sz, i, j, k, color); }

/* ------------------------------------------------------------ report */
const notGrounded = parts.filter((p, i) => !grounded[i]).length;
console.log(`closure filled ${closureFilled}, removed ${closureRemoved}`, JSON.stringify(closureBy));
console.log(`parts ${parts.length}, not grounded ${notGrounded}, dropped voxels ${dropped.length}, hung ${hung}`);
const dropBy = {}; for (const d of dropped) dropBy[d.m] = (dropBy[d.m] || 0) + 1;
console.log('dropped by material:', JSON.stringify(dropBy));
const byShape = {}; for (const p of parts) byShape[p.shape] = (byShape[p.shape] || 0) + 1;
console.log('shapes:', JSON.stringify(byShape));
const byCol = {}; for (const p of parts) byCol[p.color] = (byCol[p.color] || 0) + 1;
console.log('colours:', JSON.stringify(byCol));

/* ------------------------------------------------------------ output */
const COLORS = {
  'base':          { name: 'Harbour Floor', hex: '#263a48' },
  'harbour':       { name: 'Harbour Blue (シドニー湾)', hex: '#2e6284', roughness: 0.14, metalness: 0.15 },
  'harbour-deep':  { name: 'Harbour Deep', hex: '#255573', roughness: 0.12, metalness: 0.16 },
  'harbour-edge':  { name: 'Harbour Shallows', hex: '#3b7089', roughness: 0.16, metalness: 0.12 },
  'foam':          { name: 'Ferry Wake (航跡)', hex: '#d9e6ea', roughness: 0.3 },
  'seawall':       { name: 'Sandstone Sea Wall (護岸)', hex: '#b39a72' },
  'seawall-dark':  { name: 'Sea Wall Weathered', hex: '#9c845f' },
  'seawall-cap':   { name: 'Sea Wall Coping', hex: '#c7b595' },
  'fill':          { name: 'Structure (構造体)', hex: '#857d71' },
  'broadwalk':     { name: 'Broadwalk Paving (ブロードウォーク)', hex: '#b9a592' },
  'forecourt':     { name: 'Forecourt Paving (前庭)', hex: '#a99582' },
  'steps':         { name: 'Monumental Steps (大階段)', hex: '#bf9f88' },
  'podium-base':   { name: 'Podium Plinth', hex: '#94796a' },
  'granite':       { name: 'Pink Granite (花崗岩パネル)', hex: '#bc977f' },
  'granite-band':  { name: 'Granite Band', hex: '#a3826d' },
  'podium-core':   { name: 'Podium Structure', hex: '#857d71' },
  'podium-top':    { name: 'Podium Paving (基壇)', hex: '#c4a590' },
  'podium-joint':  { name: 'Podium Paving Joint', hex: '#b0927e' },
  'podium-edge':   { name: 'Podium Coping', hex: '#d0b6a2' },
  'window':        { name: 'Dark Glazing', hex: '#2a2e34', roughness: 0.18, metalness: 0.2 },
  'shell-core':    { name: 'Shell White', hex: '#f2f0ea' },
  'tile-white':    { name: 'Glossy White Tile (白タイル)', hex: '#fbfaf6', roughness: 0.14, metalness: 0.04 },
  'tile-cream':    { name: 'Matte Cream Tile (クリームタイル)', hex: '#e4dac6', roughness: 0.7 },
  'concrete':      { name: 'Rib Concrete (リブ)', hex: '#d6ccb6' },
  'glass':         { name: 'Topaz Glass (トパーズ色ガラス)', hex: '#5d4a33', opacity: 0.66, roughness: 0.08, metalness: 0.3 },
  'mullion':       { name: 'Bronze Mullion (ブロンズ)', hex: '#4c3b2b', roughness: 0.35, metalness: 0.4 },
  'sandstone':     { name: 'Sydney Sandstone (砂岩)', hex: '#c49a5c' },
  'sandstone-dark':{ name: 'Sandstone Dark', hex: '#a97f47' },
  'hedge':         { name: 'Hedge (生垣)', hex: '#3f5f2c' },
  'grass':         { name: 'Garden Lawn (芝生)', hex: '#5b7d3a' },
  'grass-dark':    { name: 'Garden Lawn Dark', hex: '#4c6b30' },
  'grass-light':   { name: 'Garden Lawn Light', hex: '#6d8d45' },
  'trunk':         { name: 'Fig Trunk (幹)', hex: '#5b4636' },
  'tree':          { name: 'Moreton Bay Fig (モートンベイ・イチジク)', hex: '#2f5a2e' },
  'tree-dark':     { name: 'Fig Leaves Dark', hex: '#244a26' },
  'tree-light':    { name: 'Fig Leaves Light', hex: '#3e6c35' },
  'ferry-hull':    { name: 'Ferry Green (フェリー)', hex: '#1f4a33' },
  'ferry-trim':    { name: 'Ferry Trim Green', hex: '#2b6343' },
  'ferry-deck':    { name: 'Ferry Deck', hex: '#8a7a64' },
  'ferry-cream':   { name: 'Ferry Cream', hex: '#e9dcae' },
  'ferry-window':  { name: 'Ferry Window', hex: '#30363d', roughness: 0.2 },
  'ferry-funnel':  { name: 'Ferry Funnel', hex: '#e2c35a' },
  'lamp-post':     { name: 'Lamp Post (街灯)', hex: '#3a3f45', roughness: 0.4, metalness: 0.3 },
  'lamp-light':    { name: 'Lamp Globe', hex: '#fff3cf' },
  'umbrella':      { name: 'Opera Bar Umbrella (パラソル)', hex: '#f4f1ea' },
  'wood':          { name: 'Brush Box Timber (ブラシボックス材)', hex: '#9a6a44' },
  'wood-dark':     { name: 'Timber Structure', hex: '#6f4b31' },
  'stage':         { name: 'Stage Floor (舞台)', hex: '#b88a5a' },
  'seat-wood':     { name: 'Concert Hall Seats (客席)', hex: '#7c3a3a' },
  'seat-red':      { name: 'Theatre Seats (赤い客席)', hex: '#a3202e' },
  'flytower':      { name: 'Fly Tower (フライタワー)', hex: '#3d3d42' },
  'proscenium':    { name: 'Proscenium (額縁)', hex: '#2b2b2f' },
  'organ':         { name: 'Organ Pipes (パイプ)', hex: '#c9ccd1', roughness: 0.28, metalness: 0.55 }
};
/* ------------------------------------------------------------ steps */
const mAt = y => Math.round((y - SEA) * P * 10) / 10;               // metres above the harbour
const B = (y0, title, description, split = 1) => ({ y0, title, description, split });
const BANDS = [
  B(0, '土台のプレート', '濃紺の8×8プレートを敷き詰めて、144×212スタッドの土台をつくります（1スタッド＝1.25m、1プレート＝0.5m）。西がサーキュラー・キー、東がファーム・コーブ、北がシドニー湾の本流です。', 3),
  B(1, '海面と岬の足もと', '海はタイルで平らに仕上げ、岸に近いところは明るい浅瀬の色にします。ベネロング岬には護岸の砂岩と床を支える柱を立て、基壇の外壁も立ち上げます。北の沖には緑とクリーム色のフェリー（ファースト・フリート級）が白い航跡を引いて進みます。', 3),
  B(2, '護岸と基壇の足もと', '岬のまわりを砂岩の護岸で囲みます。基壇の外壁は海面から始まり、中には支柱を一定の間隔で立てます。フェリーは船体の上にクリーム色の客室と、両端の操舵室、黄色い煙突を載せます。'),
  B(Y_SLAB, 'ブロードウォークと前庭の床', `2層のプレートで岬の床を張ります（海面から${mAt(Y_LAND)}m）。下の層は柱の上に載せ、上の層で継ぎ目をまたいで1枚につなげます。建物を一周する遊歩道「ブロードウォーク」と、南の前庭をタイルで舗装します。`),
  B(Y_LAND, `基壇と大階段 ${mAt(Y_LAND)}〜${mAt(Y_LAND + 6)}m`, 'ピンクがかった花崗岩の基壇（ポディウム）を積みます。表面はタラナ産の花崗岩を使ったプレキャストパネルで、低い階にはバーやレストラン、ホワイエの暗いガラスが並びます。南側では幅約97mの大階段（モニュメンタル・ステップ）が1段ずつ上がり始め、ブロードウォークには街灯、西側にはオペラ・バーのパラソルが並びます。'),
  B(Y_LAND + 6, `基壇と大階段 ${mAt(Y_LAND + 6)}〜${mAt(Y_LAND + 12)}m`, '基壇の外壁を積み上げ、花崗岩の帯を1本入れます。大階段は1プレートずつ上がり、南東では王立植物園を支える砂岩の崖（ターペイアン・ウォール）が立ち上がります。'),
  B(Y_LAND + 12, `基壇と大階段 ${mAt(Y_LAND + 12)}〜${mAt(Y_POD - 3)}m`, '基壇の外壁と柱を屋上の高さまで積みます。崖の上には植物園の芝生とモートンベイ・イチジクの大木を植えます。'),
  B(Y_POD - 3, '基壇の屋上', `3層のプレートで基壇の屋上（海面から${mAt(Y_POD)}m）を張ります。下の層は柱と外壁の上に載せ、中の層で継ぎ目をまたぎ、上の層を花崗岩色のタイルで仕上げます。シェルとガラス壁が立つところだけはスタッドを残します。大階段はここで上りきります。`),
];
{
  // shells: one step per 2.5 m of height; the text says which shells close in that band
  const FACTS = [
    '3つのシェル群を基壇から立ち上げます。西がコンサートホール（2,679席）、東がジョーン・サザーランド劇場（1,507席）、南西の角がレストランのベネロングです。各シェルは左右1点ずつの脚（ペデスタル）で立ちます。',
    '脚と脚のあいだのすき間はトパーズ色のガラスでふさぎます。ガラスは約6,000㎡、フランスで特注された2,000枚あまりの板ガラスです。',
    'シェルは半径75.2mの球面から切り出した三角形の組み合わせです（ウッツォンの「球面解法」）。左右の半シェルが鏡像になっていて、正面から見るととがったアーチになります。',
    'ガラスの壁にはブロンズの方立て（縦桟）と横桟が入ります。港に面した北のホワイエからは、ハーバーブリッジと湾が一望できます。',
    'シェルの表面は白い光沢タイルとクリーム色のつや消しタイル、合わせて1,056,006枚。スウェーデンのヘガネス社で焼かれました。脚から扇形に広がるリブに沿ってクリーム色の線が入ります。',
    'シェルの骨組みは2,194個のプレキャスト・コンクリートのリブで、総延長350kmの鋼線で締め付けられています。',
    '北のシェルは港に向かって口を開き、前へ大きく張り出します。ガラスは縁より内側に下げて、白いシェルの縁（コンクリートの縁梁）を際立たせます。',
    '南の大階段の上では、背中合わせのシェルが入口を覆います。観客は階段を上って、この南側のシェルの下からホワイエに入ります。',
    'シェルは奥へ行くほど高くなり、前のシェルの背中が次のシェルの口の中へ消えていきます。重なりのすき間はガラスで閉じます。',
    'ジョーン・サザーランド劇場はオペラとバレエの劇場で、オーストラリア・オペラの本拠地です。',
    'シェルの形は「オレンジの皮」から着想したとも言われます。すべてのシェルを同じ球面から切り出したことで、リブを同じ型で量産できるようになりました。',
    'タイルは工場で4,253枚の山形のパネル（タイル・リッド）に貼ってから、クレーンでシェルに取り付けられました。',
    '光沢のある白タイルは汚れが雨で流れ落ちるように焼かれていて、晴れた日には港の光を映して輝きます。',
    'コンサートホールには10,154本のパイプをもつ世界最大級の機械式パイプオルガン「グランド・オルガン」があります。',
    '尾根は左右の半シェルが出会う折れ線で、先端に向かって鋭くなります。',
    '1957年の国際コンペで、デンマークの建築家ヨーン・ウッツォンの案が233案の中から選ばれました。',
    '工事は1959年に始まり、1973年10月20日にエリザベス2世女王を迎えて開館しました。',
    'ウッツォンは1966年に設計者を辞任し、ガラス壁と内装はピーター・ホールらのチームが完成させました。',
    '建設費は当初の見積もり700万豪ドルに対し、最終的に1億200万豪ドルにのぼりました。',
    'ベネロングの名は、この岬に暮らした先住民の男性ウーララワレ・ベネロングにちなみます。',
    '年間1,500回を超える公演が行われ、オペラ、コンサート、演劇、バレエの舞台になっています。',
    '2007年にユネスコの世界遺産に登録されました。20世紀の建築を代表する作品のひとつです。',
    '最も高いシェルの先端に近づきます。尾根の線は、左右の半シェルが出会う鋭い折れ線です。'
  ];
  const tips = [];
  for (const hall of HALLS) for (const sh of hall.shells) tips.push({ y: Y_POD + Math.round(sh.hT / P), label: `${hall.label}の${sh.dir > 0 ? (hall.name === 'bennelong' ? '北向きの' : '港に向かう') : (hall.name === 'bennelong' ? '街に向かう' : '南向きの')}シェル（${sh.name}）` });
  const top = Math.max(...tips.map(t => t.y));
  let n = 0;
  for (let y0 = Y_POD; y0 < top; y0 += 5, n++) {
    const y1 = Math.min(top, y0 + 5);
    const closing = tips.filter(t => t.y > y0 && t.y <= y1);
    let d = FACTS[n % FACTS.length];
    if (closing.length) d += ' この高さで' + closing.map(t => t.label).join('、') + 'の先端が閉じます。';
    const last = y1 === top;
    BANDS.push(B(y0, last ? `シェルの頂部 ${mAt(y0)}〜${mAt(y1)}m` : `シェル ${mAt(y0)}〜${mAt(y1)}m`,
      last ? d + ' コンサートホールのいちばん高いシェルの先端は海面から約67m、22階建てのビルに相当します。これで完成です。' : d));
  }
}
const bandOf = y => { let b = 0; for (let i = 0; i < BANDS.length; i++) if (y >= BANDS[i].y0) b = i; return b; };

// prune the few parts that could not reach the ground (hung plates whose part above was lost)
const partOrder = parts.map((p, i) => i).sort((a, b) => parts[a].y - parts[b].y || a - b);
let blocks = partOrder.map((pi, n) => {
  const p = parts[pi];
  return { id: `block_${String(n + 1).padStart(5, '0')}`, shape: p.shape, width: p.width, depth: p.depth, height: p.height, x: p.x, y: p.y, z: p.z, rotation: p.rotation, color: p.color, step: 0 };
});
// steps: one band of heights each; single-level bands are split into strips from south to north
const stepKeys = [];
for (const b of blocks) {
  const bi = bandOf(b.y), band = BANDS[bi];
  const part = band.split > 1 ? Math.min(band.split - 1, Math.floor(b.z / (NZ / band.split))) : 0;
  b.step = bi * 100 + part;
}
const usedColors = new Set(blocks.map(b => b.color));
const raw = {
  format: 'blockmade.model', version: 2,
  name: 'シドニー・オペラハウス', nameEn: 'Sydney Opera House',
  description: '',
  author: 'Claude', prompt: '超リアルなオペラハウス', createdAt: '2026-09-24',
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
  // build order, by simulation. Parts fall in three kinds: DS parts stand on a chain of parts down
  // to the base, US parts hang under a DS / US part, riders sit on hung parts. Within a step they are
  // listed DS bottom-up, US top-down, riders bottom-up, and the checker's greedy passes are replayed
  // exactly; a part that would go on too early (so that a neighbour would later be sandwiched) is
  // sent to the next step and the step is replayed.
  {
    const m0 = core.normalizeModel(raw), chk = core.validateModel(m0), Bk = m0.blocks, N = Bk.length;
    const above = Bk.map(b => chk.above.get(b.id).map(id => m0.byId.get(id).index));
    const below = Bk.map(b => chk.below.get(b.id).map(id => m0.byId.get(id).index));
    const kind = new Uint8Array(N);                                   // 0 DS, 1 US, 2 rider
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
    // placing i now is too early if a neighbour still to come would then be held from both sides
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
        for (const i of placedNow) at[i] = null;                     // replay without the early part
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
// number the steps and give them their titles
const usedSteps = [...new Set(raw.blocks.map(b => b.step))].sort((a, b) => a - b);
const stepNo = new Map(usedSteps.map((s, i) => [s, i + 1]));
raw.steps = usedSteps.map(s => {
  const band = BANDS[Math.floor(s / 100)], part = s % 100;
  const t = band.split > 1 && part < band.split ? `${band.title}（${part + 1}/${band.split}）` : part ? `${band.title}（仕上げ${part > 1 ? part : ''}）` : band.title;
  return { step: stepNo.get(s), title: t, description: band.description };
});
raw.blocks.forEach(b => { b.step = stepNo.get(b.step); });
raw.blocks.forEach((b, n) => { b.id = `block_${String(n + 1).padStart(5, '0')}`; });
const m = core.normalizeModel(raw);
const fin = core.validateModel(m);
const bx = m.bounds;
raw.description = `港に突き出たベネロング岬に立つシドニー・オペラハウスを、1スタッド＝1.25m・1プレート＝0.5mで再現。半径75.2mの球面から切り出したシェルを幾何計算でそのまま割り付け、白とクリームのタイル、リブの線、とがったアーチの口に下げたトパーズ色のガラス壁、ピンクの花崗岩の基壇と幅97mの大階段、ブロードウォークの街灯、オペラ・バーのパラソル、王立植物園の崖とイチジクの大木、湾を行くフェリーまで。${bx.maxX - bx.minX}×${bx.maxZ - bx.minZ}スタッド・高さ${m.heightPlates}プレート・${m.blocks.length}パーツ。`;
writeFileSync(join(root, 'models/sydney-opera-house.json'), core.modelToJSON(core.normalizeModel(raw)));
console.log(`wrote ${m.blocks.length} parts (pruned ${pruned}, dropped ${dropStuck} unorderable, moved ${moved}), ${raw.steps.length} steps, valid: ${fin.allOk}` + (fin.allOk ? '' : ' ' + core.describeIssues(m, fin, 10).join(' | ')));

if (process.env.DEBUG_X) {
  // side section at model X (metres): rows = plate levels (top first), columns = z (south -> north)
  const CH = { 'tile-white': 'W', 'tile-cream': 'c', 'concrete': 'o', 'shell-core': '#', 'glass': 'g', 'mullion': 'm' };
  for (const xm of process.env.DEBUG_X.split(',').map(Number)) {
    const i = iOf(xm);
    console.log(`--- section X=${xm} m (i=${i})`);
    for (let j = NY - 1; j >= Y_POD - 2; j--) {
      let line = '';
      for (let k = kOf(-70); k < kOf(80); k++) { const m = vox[idx(i, k, j)]; line += !m ? (occ[idx(i, k, j)] ? '*' : ' ') : (CH[MATS[m]] || '.'); }
      if (line.trim()) console.log(String(j).padStart(3) + ' ' + line);
    }
  }
}
if (process.env.DEBUG_DROP) {
  const by = {};
  for (const d of dropped) { const k = `${d.m}@${d.j}`; by[k] = (by[k] || 0) + 1; }
  console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k}:${v}`).join('  '));
}
if (process.env.DEBUG_Y) {
  for (const yy of process.env.DEBUG_Y.split(',').map(Number)) {
    const dr = new Set(dropped.filter(d => d.j === yy).map(d => d.i * 1000 + d.k));
    const ks = [...dr].map(v => v % 1000), is = [...dr].map(v => Math.floor(v / 1000));
    if (!dr.size) continue;
    const kc = Math.round(ks.reduce((a, b) => a + b, 0) / ks.length), ic = Math.round(is.reduce((a, b) => a + b, 0) / is.length);
    console.log(`--- y=${yy} around i=${ic} k=${kc}  (#=part  o=dropped  .=stud below  -=voxel below exists)`);
    for (let k = kc + 12; k >= kc - 12; k--) {
      let line = '';
      for (let i = ic - 30; i < ic + 30; i++) {
        const id = idx(i, k, yy);
        line += dr.has(i * 1000 + k) ? 'o' : occ[id] ? '#' : studOwner[id] >= 0 ? '.' : ' ';
      }
      console.log(line);
    }
  }
}
