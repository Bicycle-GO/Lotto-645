import { appendFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STORE_COVERAGE_START, validateLottoMapData } from '../lib/lotto-data.mjs';

const COVERAGE_START = STORE_COVERAGE_START;
const MAX_CONCURRENCY = 3;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_REQUEST_GAP_MS = 1_000;
const DEFAULT_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 30_000;

const LOTTERY_ORIGIN = 'https://www.dhlottery.co.kr';
const DRAW_INDEX_URL = `${LOTTERY_ORIGIN}/lt645/selectLtEpsdInfo.do`;
const DRAW_RESULT_URL = `${LOTTERY_ORIGIN}/lt645/selectPstLt645InfoNew.do`;
const STORE_URL = `${LOTTERY_ORIGIN}/wnprchsplcsrch/selectLtWnShp.do`;
const DRAW_REFERER = `${LOTTERY_ORIGIN}/lt645/result`;
const STORE_REFERER = `${LOTTERY_ORIGIN}/wnprchsplcsrch/home`;
const USER_AGENT = 'Lotto645MapSnapshotBuilder/1.0 (static archive build)';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const siteDirectory = resolve(scriptDirectory, '..');
const outputPath = resolve(siteDirectory, 'public', 'data', 'lotto-map-data.json');
const temporaryOutputPath = `${outputPath}.tmp`;
const checkpointPath = resolve(siteDirectory, '.lotto-build-checkpoint.ndjson');
const drawCheckpointPath = resolve(siteDirectory, '.lotto-draws-checkpoint.json');

function readIntegerSetting(name, fallback, { min, max }) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}; received ${raw}`);
  }
  return value;
}

const concurrency = readIntegerSetting('LOTTO_BUILD_CONCURRENCY', DEFAULT_CONCURRENCY, {
  min: 1,
  max: MAX_CONCURRENCY,
});
const requestGapMs = readIntegerSetting('LOTTO_BUILD_REQUEST_GAP_MS', DEFAULT_REQUEST_GAP_MS, {
  min: 100,
  max: 10_000,
});
const maxRetries = readIntegerSetting('LOTTO_BUILD_RETRIES', DEFAULT_RETRIES, {
  min: 0,
  max: 10,
});

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

let requestGate = Promise.resolve();
let nextRequestAt = 0;

async function waitForRequestSlot() {
  let releaseGate;
  const previousGate = requestGate;
  requestGate = new Promise((resolveGate) => {
    releaseGate = resolveGate;
  });

  await previousGate;
  const delayMs = Math.max(0, nextRequestAt - Date.now());
  if (delayMs > 0) await sleep(delayMs);
  nextRequestAt = Date.now() + requestGapMs;
  releaseGate();
}

function retryDelay(response, attempt) {
  const retryAfter = response?.headers?.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 60_000);
    const retryDate = Date.parse(retryAfter);
    if (Number.isFinite(retryDate)) return Math.min(Math.max(0, retryDate - Date.now()), 60_000);
  }

  const exponential = Math.min(1_000 * (2 ** attempt), 30_000);
  return exponential + Math.floor(Math.random() * 500);
}

async function fetchJson(url, referer) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response;
    try {
      await waitForRequestSlot();
      response = await fetch(url, {
        headers: {
          Accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
          Referer: referer,
          'User-Agent': USER_AGENT,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 240).replaceAll(/\s+/g, ' ');
        const error = new Error(`HTTP ${response.status} for ${url}: ${body}`);
        error.status = response.status;
        throw error;
      }

      const contentType = response.headers.get('content-type') ?? '';
      const body = await response.text();
      if (!contentType.includes('json') && !body.trimStart().startsWith('{')) {
        throw new Error(`Expected JSON for ${url}; received ${contentType || 'unknown content type'}`);
      }

      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object' || !parsed.data) {
        throw new Error(`Unexpected response envelope for ${url}`);
      }
      return parsed;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status);
      const retryable = !Number.isFinite(status) || status === 408 || status === 425
        || status === 429 || status >= 500;
      if (!retryable || attempt === maxRetries) break;

      const delayMs = retryDelay(response, attempt);
      console.warn(`Request failed; retrying in ${delayMs}ms (${attempt + 1}/${maxRetries}): ${error.message}`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function asNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid numeric ${fieldName}: ${value}`);
  return number;
}

function normalizeText(value) {
  return String(value ?? '').replaceAll(/\s+/g, ' ').trim();
}

function formatDate(value) {
  const digits = String(value ?? '').replaceAll(/\D/g, '');
  if (digits.length !== 8) throw new Error(`Invalid draw date: ${value}`);
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function toDraw(row) {
  return {
    draw: asNumber(row.ltEpsd, 'ltEpsd'),
    date: formatDate(row.ltRflYmd),
    numbers: [
      asNumber(row.tm1WnNo, 'tm1WnNo'),
      asNumber(row.tm2WnNo, 'tm2WnNo'),
      asNumber(row.tm3WnNo, 'tm3WnNo'),
      asNumber(row.tm4WnNo, 'tm4WnNo'),
      asNumber(row.tm5WnNo, 'tm5WnNo'),
      asNumber(row.tm6WnNo, 'tm6WnNo'),
    ],
    bonus: asNumber(row.bnsWnNo, 'bnsWnNo'),
    firstPrize: asNumber(row.rnk1WnAmt, 'rnk1WnAmt'),
    secondPrize: asNumber(row.rnk2WnAmt, 'rnk2WnAmt'),
    firstWinners: asNumber(row.rnk1WnNope, 'rnk1WnNope'),
    secondWinners: asNumber(row.rnk2WnNope, 'rnk2WnNope'),
  };
}

async function fetchLatestDraw() {
  const response = await fetchJson(DRAW_INDEX_URL, DRAW_REFERER);
  const rows = response.data.list;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Draw index is empty');

  const officialLatest = Math.max(...rows.map((row) => asNumber(row.ltEpsd, 'ltEpsd')));
  const requestedLatest = process.env.LOTTO_BUILD_LATEST_DRAW
    ? readIntegerSetting('LOTTO_BUILD_LATEST_DRAW', officialLatest, { min: COVERAGE_START, max: officialLatest })
    : officialLatest;
  return requestedLatest;
}

async function fetchDraws(latestDraw, firstDraw = COVERAGE_START) {
  const rowsByDraw = new Map();
  let cursor;

  while (rowsByDraw.size < latestDraw - firstDraw + 1) {
    const params = cursor === undefined
      ? new URLSearchParams({ srchDir: 'center', srchLtEpsd: String(latestDraw) })
      : new URLSearchParams({ srchDir: 'older', srchCursorLtEpsd: String(cursor) });
    const response = await fetchJson(`${DRAW_RESULT_URL}?${params}`, DRAW_REFERER);
    const rows = response.data.list;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`Draw result page is empty at cursor ${cursor ?? latestDraw}`);
    }

    const pageDraws = rows.map(toDraw);
    for (const draw of pageDraws) {
      if (draw.draw >= firstDraw && draw.draw <= latestDraw) rowsByDraw.set(draw.draw, draw);
    }

    const nextCursor = Math.min(...pageDraws.map((draw) => draw.draw));
    if (nextCursor <= firstDraw) break;
    if (cursor !== undefined && nextCursor >= cursor) {
      throw new Error(`Draw pagination did not advance: ${cursor} -> ${nextCursor}`);
    }
    cursor = nextCursor;
  }

  const expectedCount = latestDraw - firstDraw + 1;
  const missing = [];
  for (let draw = firstDraw; draw <= latestDraw; draw += 1) {
    if (!rowsByDraw.has(draw)) missing.push(draw);
  }
  if (missing.length > 0 || rowsByDraw.size !== expectedCount) {
    throw new Error(`Draw result coverage mismatch; expected ${expectedCount}, got ${rowsByDraw.size}, missing ${missing.slice(0, 20).join(', ')}`);
  }

  return [...rowsByDraw.values()].sort((a, b) => b.draw - a.draw);
}

async function loadOrFetchDraws(latestDraw) {
  try {
    const cached = JSON.parse(await readFile(drawCheckpointPath, 'utf8'));
    if (cached.latestDraw === latestDraw && Array.isArray(cached.draws)
      && cached.draws.length === latestDraw - COVERAGE_START + 1
      && new Set(cached.draws.map((draw) => draw.draw)).size === cached.draws.length
      && cached.draws.every((draw) => Number.isInteger(draw.draw) && draw.draw >= COVERAGE_START && draw.draw <= latestDraw)) {
      return cached.draws;
    }
  } catch {
    // A missing or interrupted checkpoint is regenerated from the official source.
  }
  const draws = await fetchDraws(latestDraw);
  await writeFile(drawCheckpointPath, JSON.stringify({ latestDraw, draws }), 'utf8');
  return draws;
}

async function loadCheckpoint(firstDraw, latestDraw) {
  const cached = new Map();
  let text;
  try {
    text = await readFile(checkpointPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return cached;
    throw error;
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (Number.isInteger(entry.draw) && entry.draw >= firstDraw && entry.draw <= latestDraw
        && Array.isArray(entry.rows) && entry.rows.length > 0) {
        cached.set(entry.draw, entry.rows);
      }
    } catch {
      // A process interruption can leave one truncated final line. It is safe to refetch that draw.
    }
  }

  return cached;
}

async function fetchStoreDraw(draw) {
  const params = new URLSearchParams({
    srchWnShpRnk: 'all',
    srchLtEpsd: String(draw),
    srchShpLctn: '',
  });
  const response = await fetchJson(`${STORE_URL}?${params}`, STORE_REFERER);
  const rows = response.data.list;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`Store result for draw ${draw} is empty`);

  const reportedTotal = Number(response.data.total);
  if (Number.isFinite(reportedTotal) && reportedTotal !== rows.length) {
    throw new Error(`Store result count mismatch for draw ${draw}: ${reportedTotal} != ${rows.length}`);
  }
  return rows;
}

async function mapWithConcurrency(items, worker, onResult) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      const result = await worker(item);
      await onResult(item, result, index);
    }
  });
  await Promise.all(workers);
}

function isOnlineSeller(row) {
  const value = `${normalizeText(row.shpNm)} ${normalizeText(row.shpAddr)}`;
  return /인터넷\s*복권판매사이트/i.test(value);
}

function hasValidKoreanCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= 32 && lat <= 39.5
    && lng >= 124 && lng <= 132.5;
}

export function buildStores(storeRowsByDraw) {
  const storesById = new Map();
  const exclusions = {
    onlineRows: 0,
    invalidCoordinateRows: 0,
    missingIdRows: 0,
    invalidRankRows: 0,
    coordinateChanges: 0,
  };
  let inputRows = 0;

  const orderedDraws = [...storeRowsByDraw.keys()].sort((a, b) => a - b);
  for (const draw of orderedDraws) {
    for (const row of storeRowsByDraw.get(draw)) {
      inputRows += 1;
      if (isOnlineSeller(row)) {
        exclusions.onlineRows += 1;
        continue;
      }

      const id = normalizeText(row.ltShpId);
      if (!id) {
        exclusions.missingIdRows += 1;
        continue;
      }

      const lat = Number(row.shpLat);
      const lng = Number(row.shpLot);
      if (!hasValidKoreanCoordinate(lat, lng)) {
        exclusions.invalidCoordinateRows += 1;
        continue;
      }

      const rank = Number(row.wnShpRnk);
      if (rank !== 1 && rank !== 2) {
        exclusions.invalidRankRows += 1;
        continue;
      }

      const method = normalizeText(row.atmtPsvYnTxt);
      let internalStore = storesById.get(id);
      if (!internalStore) {
        internalStore = {
          id,
          name: normalizeText(row.shpNm),
          address: normalizeText(row.shpAddr),
          region: normalizeText(row.region || row.tm1ShpLctnAddr),
          phone: normalizeText(row.shpTelno),
          lat,
          lng,
          winsByKey: new Map(),
        };
        storesById.set(id, internalStore);
      } else {
        if (Math.abs(internalStore.lat - lat) > 0.000001 || Math.abs(internalStore.lng - lng) > 0.000001) {
          exclusions.coordinateChanges += 1;
        }
        // Rows are processed oldest to newest, so the final marker uses the latest official listing.
        internalStore.name = normalizeText(row.shpNm) || internalStore.name;
        internalStore.address = normalizeText(row.shpAddr) || internalStore.address;
        internalStore.region = normalizeText(row.region || row.tm1ShpLctnAddr) || internalStore.region;
        internalStore.phone = normalizeText(row.shpTelno) || internalStore.phone;
        internalStore.lat = lat;
        internalStore.lng = lng;
      }

      const winKey = `${draw}|${rank}|${method}`;
      const existingWin = internalStore.winsByKey.get(winKey);
      if (existingWin) {
        existingWin.tickets += 1;
      } else {
        internalStore.winsByKey.set(winKey, { draw, rank, method, tickets: 1 });
      }
    }
  }

  const stores = [...storesById.values()].map((store) => {
    const outputStore = {
      id: store.id,
      name: store.name || '이름 미제공 판매점',
      address: store.address,
      region: store.region,
      lat: store.lat,
      lng: store.lng,
      wins: [...store.winsByKey.values()].sort((a, b) => (
        b.draw - a.draw || a.rank - b.rank || a.method.localeCompare(b.method, 'ko')
      )),
    };
    if (store.phone) outputStore.phone = store.phone;
    return outputStore;
  }).sort((a, b) => a.id.localeCompare(b.id));

  return { stores, inputRows, exclusions };
}

export function extendArchive(previous, newDraws, newStoreRows, generatedAt = new Date().toISOString()) {
  validateLottoMapData(previous);
  if (!newDraws.length || newDraws.some((draw) => draw.draw <= previous.latestDraw)) {
    throw new Error('An archive update must contain only new draws.');
  }
  const drawIds = new Set(newDraws.map((draw) => draw.draw));
  if (newStoreRows.size !== drawIds.size || [...newStoreRows.keys()].some((draw) => !drawIds.has(draw))) {
    throw new Error('New draw results and store records must cover the same draws.');
  }
  const { stores: newStores } = buildStores(newStoreRows);
  const storesById = new Map(previous.stores.map((store) => [store.id, store]));
  for (const store of newStores) {
    const old = storesById.get(store.id);
    storesById.set(store.id, old ? {
      ...old,
      ...store,
      name: store.name === '이름 미제공 판매점' ? old.name : store.name,
      address: store.address || old.address,
      region: store.region || old.region,
      wins: [...store.wins, ...old.wins],
    } : store);
  }
  const data = {
    ...previous,
    generatedAt,
    latestDraw: Math.max(...drawIds),
    draws: [...newDraws, ...previous.draws].sort((a, b) => b.draw - a.draw),
    stores: [...storesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
  validateLottoMapData(data);
  return data;
}

function validateOutput(data) {
  const expectedDrawCount = data.latestDraw - data.coverageStart + 1;
  if (data.draws.length !== expectedDrawCount) {
    throw new Error(`Output draw count mismatch: ${data.draws.length} != ${expectedDrawCount}`);
  }

  const drawIds = new Set(data.draws.map((draw) => draw.draw));
  const storeIds = new Set();
  for (const store of data.stores) {
    if (storeIds.has(store.id)) throw new Error(`Duplicate store id in output: ${store.id}`);
    storeIds.add(store.id);
    if (!hasValidKoreanCoordinate(store.lat, store.lng)) {
      throw new Error(`Invalid output coordinate for store ${store.id}`);
    }
    if (isOnlineSeller({ shpNm: store.name, shpAddr: store.address })) {
      throw new Error(`Online seller remains in output: ${store.id}`);
    }

    const winKeys = new Set();
    for (const win of store.wins) {
      if (!drawIds.has(win.draw)) throw new Error(`Store ${store.id} refers to missing draw ${win.draw}`);
      if (win.rank !== 1 && win.rank !== 2) throw new Error(`Invalid output rank at store ${store.id}`);
      if (!Number.isInteger(win.tickets) || win.tickets < 1) {
        throw new Error(`Invalid ticket count at store ${store.id}`);
      }
      const key = `${win.draw}|${win.rank}|${win.method}`;
      if (winKeys.has(key)) throw new Error(`Unmerged win key ${key} at store ${store.id}`);
      winKeys.add(key);
    }
  }
}

async function main() {
  console.log(`Building lotto map snapshot with concurrency=${concurrency}, requestGapMs=${requestGapMs}`);
  const previous = process.argv.includes('--update')
    ? JSON.parse(await readFile(outputPath, 'utf8'))
    : null;
  if (previous) validateLottoMapData(previous);
  const latestDraw = await fetchLatestDraw();
  console.log(`Official draw range selected: ${COVERAGE_START}-${latestDraw}`);
  if (previous && latestDraw <= previous.latestDraw) {
    if (latestDraw < previous.latestDraw) throw new Error('Refusing to roll back the existing archive.');
    console.log(`Archive is already current through draw ${latestDraw}; no files changed.`);
    return;
  }
  const firstDraw = previous ? previous.latestDraw + 1 : COVERAGE_START;

  const draws = previous ? await fetchDraws(latestDraw, firstDraw) : await loadOrFetchDraws(latestDraw);
  console.log(`Fetched ${draws.length} draw result records`);

  const storeRowsByDraw = await loadCheckpoint(firstDraw, latestDraw);
  const allDrawIds = Array.from(
    { length: latestDraw - firstDraw + 1 },
    (_, index) => firstDraw + index,
  );
  const missingDrawIds = allDrawIds.filter((draw) => !storeRowsByDraw.has(draw));
  if (storeRowsByDraw.size > 0) {
    console.log(`Resuming with ${storeRowsByDraw.size} store draws from checkpoint`);
  }

  let completed = storeRowsByDraw.size;
  await mapWithConcurrency(missingDrawIds, fetchStoreDraw, async (draw, rows) => {
    storeRowsByDraw.set(draw, rows);
    appendFileSync(checkpointPath, `${JSON.stringify({ draw, rows })}\n`, 'utf8');
    completed += 1;
    if (completed % 25 === 0 || completed === allDrawIds.length) {
      console.log(`Store progress: ${completed}/${allDrawIds.length} draws`);
    }
  });

  const missingAfterFetch = allDrawIds.filter((draw) => !storeRowsByDraw.has(draw));
  if (missingAfterFetch.length > 0) {
    throw new Error(`Missing store draws after fetch: ${missingAfterFetch.slice(0, 20).join(', ')}`);
  }

  const { stores, inputRows, exclusions } = buildStores(storeRowsByDraw);
  const data = previous ? extendArchive(previous, draws, storeRowsByDraw) : {
    generatedAt: new Date().toISOString(),
    coverageStart: COVERAGE_START,
    latestDraw,
    source: '동행복권 공개 데이터',
    draws,
    stores,
  };
  validateOutput(data);
  validateLottoMapData(data);

  await mkdir(dirname(outputPath), { recursive: true });
  const serialized = JSON.stringify(data);
  await writeFile(temporaryOutputPath, serialized, 'utf8');
  await rename(temporaryOutputPath, outputPath);
  await rm(checkpointPath, { force: true });
  await rm(drawCheckpointPath, { force: true });

  const winGroups = data.stores.reduce((sum, store) => sum + store.wins.length, 0);
  const ticketRows = data.stores.reduce(
    (sum, store) => sum + store.wins.reduce((storeSum, win) => storeSum + win.tickets, 0),
    0,
  );
  console.log(JSON.stringify({
    outputPath,
    bytes: Buffer.byteLength(serialized),
    draws: data.draws.length,
    fetchedDraws: draws.length,
    inputStoreRows: inputRows,
    stores: data.stores.length,
    winGroups,
    retainedTicketRows: ticketRows,
    exclusions,
  }, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(async (error) => {
    await rm(temporaryOutputPath, { force: true }).catch(() => undefined);
    console.error(error);
    process.exitCode = 1;
  });
}
