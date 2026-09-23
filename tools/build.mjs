// Builds self-contained pages from blockmade.html:
//   dist/artifact.html  page body for the claude.ai Artifact (no <html>/<head>)
//   index.html          standalone document, opens directly from disk
// js/model-core.js and every work in models/ are inlined, so the page loads
// no local files at runtime (the Artifact viewer only allows CDN scripts).
//   node tools/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const safe = s => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

const index = JSON.parse(read('models/index.json'));
for (const w of index.works) w.raw = JSON.parse(read(w.file));

let page = read('blockmade.html');
const core = '<script src="js/model-core.js"></script>';
if (!page.includes(core) || !page.includes('<!--LIBRARY-->')) throw new Error('blockmade.html is missing the build markers');
page = page.replace(core, () => `<script>\n${safe(read('js/model-core.js'))}</script>`);
page = page.replace('<!--LIBRARY-->', () => `<script>\nwindow.BLOCKMADE_LIBRARY = ${safe(JSON.stringify(index))};\n</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/artifact.html'), page);
writeFileSync(join(root, 'index.html'), `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${page}
</body>
</html>
`);
console.log(`built dist/artifact.html and index.html (${index.works.length} works, ${Math.round(page.length / 1024)} KB)`);
