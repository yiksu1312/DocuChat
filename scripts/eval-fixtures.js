import { mkdir, writeFile } from 'node:fs/promises';
import { makePDF } from './fixtures.js';
import materials from '../eval/materials.json' with { type: 'json' };
await mkdir('fixtures', { recursive: true });
for (const [name, pages] of Object.entries(materials)) await writeFile('fixtures/eval-' + name + '.pdf', await makePDF(pages));
console.log('Public synthetic evaluation PDFs created; no model calls.');
