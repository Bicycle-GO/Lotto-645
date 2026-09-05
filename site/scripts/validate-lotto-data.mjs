import { readFile } from 'node:fs/promises';
import { validateLottoMapData } from '../lib/lotto-data.mjs';

try {
  const source = await readFile(new URL('../public/data/lotto-map-data.json', import.meta.url), 'utf8');
  const data = JSON.parse(source);
  validateLottoMapData(data);
  if (process.argv.includes('--built')) {
    const built = await readFile(new URL('../dist/client/data/lotto-map-data.json', import.meta.url), 'utf8');
    if (built !== source) throw new Error('Built map data does not match the validated archive.');
    console.log('Verified /data/lotto-map-data.json is included in the deployment assets.');
  }
  const tickets = data.stores.reduce((sum, store) => sum + store.wins.reduce((count, win) => count + win.tickets, 0), 0);
  console.log(`Validated draws ${data.coverageStart}–${data.latestDraw}: ${data.draws.length} draws, ${data.stores.length} stores, ${tickets} winning tickets.`);
} catch (error) {
  console.error('A complete lotto map archive is required. Run pnpm data:build before building the site.');
  console.error(error.message);
  process.exitCode = 1;
}
