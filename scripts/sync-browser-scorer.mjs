import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const webDir = resolve(root, 'web');
mkdirSync(webDir, { recursive: true });

const tsSource = readFileSync(resolve(root, 'src/lib/le-scoring/scorer.ts'), 'utf8');
const jsOutput = stripTypeScriptTypes(tsSource);

const banner =
  '// AUTO-GENERATED FROM src/lib/le-scoring/scorer.ts via scripts/sync-browser-scorer.mjs\n' +
  '// Do not edit by hand — run `npm run sync:web` after modifying scorer.ts.\n\n';

writeFileSync(resolve(webDir, 'scorer.js'), banner + jsOutput, 'utf8');
copyFileSync(
  resolve(root, 'docs/rubric/rubric-v0.3.json'),
  resolve(webDir, 'rubric-v0.3.json'),
);

console.log('Synced web/scorer.js and web/rubric-v0.3.json from canonical v0.3.0 sources.');
