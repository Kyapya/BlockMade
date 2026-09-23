// Wraps blockmade.html (the Artifact page body) into a standalone index.html
// that can be opened directly in any browser: node tools/build-standalone.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const body = readFileSync(join(root, 'blockmade.html'), 'utf8');
const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${body}
</body>
</html>
`;
writeFileSync(join(root, 'index.html'), html);
console.log('wrote index.html');
