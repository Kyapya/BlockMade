// Validates every work in models/*.json and rebuilds models/index.json.
//   node tools/validate.mjs            -> check all, write index
//   node tools/validate.mjs file.json  -> check one file only
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = require(join(root, 'js/model-core.js'));

function check(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const m = core.normalizeModel(raw);
  const c = core.validateModel(m);
  const issues = core.describeIssues(m, c, 200);
  const tag = c.allOk ? 'OK  ' : 'FAIL';
  console.log(`${tag} ${basename(file)}  ${m.name}: ${m.blocks.length} blocks, ${m.steps.length} steps, ${m.layers} layers`);
  for (const w of m.warnings) console.log('     warn: ' + w);
  for (const i of issues) console.log('     ' + i);
  return { raw, m, c };
}

const only = process.argv[2];
if (only) { process.exit(check(only).c.allOk ? 0 : 1); }

const dir = join(root, 'models');
const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').sort();
let prev = [];
try { prev = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).works || []; } catch {}
const order = new Map(prev.map((w, i) => [w.file, i]));
let failed = 0;
const works = files.map(f => {
  const { raw, m, c } = check(join(dir, f));
  if (!c.allOk) failed++;
  return {
    id: f.replace(/\.json$/, ''), file: `models/${f}`,
    name: m.name, nameEn: m.nameEn, description: m.description,
    author: raw.author || '', createdAt: raw.createdAt || '',
    blocks: m.blocks.length, steps: m.steps.length, layers: m.layers,
    size: `${m.bounds.maxX - m.bounds.minX}×${m.bounds.maxZ - m.bounds.minZ}×${+(m.heightPlates / 3).toFixed(1)}`
  };
}).sort((a, b) => (order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9) || (a.createdAt || '').localeCompare(b.createdAt || ''));
writeFileSync(join(dir, 'index.json'), JSON.stringify({ format: 'blockmade.library', version: 1, works }, null, 2) + '\n');
console.log(`index.json: ${works.length} works${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
