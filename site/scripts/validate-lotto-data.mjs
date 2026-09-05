import { access, readFile } from 'node:fs/promises';
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
  if (process.argv.includes('--static')) {
    const clientRoot = new URL('../dist/client/', import.meta.url);
    const html = await readFile(new URL('index.html', clientRoot), 'utf8');
    if (!html.includes('<html') || !html.includes('로또')) {
      throw new Error('The static home page is missing or invalid.');
    }
    const assetPaths = [...html.matchAll(/(?:src|href)="(\/[^"?#]*\.(?:js|css))(?:[?#][^"]*)?"/g)]
      .map((match) => match[1].slice(1));
    if (!assetPaths.some((asset) => asset.endsWith('.js'))
      || !assetPaths.some((asset) => asset.endsWith('.css'))) {
      throw new Error('The static home page must include its JavaScript and styles.');
    }
    await Promise.all(assetPaths.map((asset) => access(new URL(asset, clientRoot))));
    console.log('Verified the static home page and all referenced JavaScript/CSS assets.');
  }
  const tickets = data.stores.reduce((sum, store) => sum + store.wins.reduce((count, win) => count + win.tickets, 0), 0);
  console.log(`Validated draws ${data.coverageStart}–${data.latestDraw}: ${data.draws.length} draws, ${data.stores.length} stores, ${tickets} winning tickets.`);
} catch (error) {
  console.error('A complete lotto map archive is required. Run pnpm data:build before building the site.');
  console.error(error.message);
  process.exitCode = 1;
}
