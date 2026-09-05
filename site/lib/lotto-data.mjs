export const STORE_COVERAGE_START = 262;

/**
 * Reject partial previews and incomplete archives in both the browser and builds.
 * @param {unknown} value
 * @returns {asserts value is import('../app/lotto-types').LottoMapData}
 */
export function validateLottoMapData(value) {
  const fail = (message) => { throw new Error(`Invalid lotto archive: ${message}`); };
  if (!value || typeof value !== 'object') fail('expected an object');
  const data = value;
  if (data.coverageStart !== STORE_COVERAGE_START
    || !Number.isInteger(data.latestDraw) || data.latestDraw < STORE_COVERAGE_START) {
    fail(`coverage must begin at draw ${STORE_COVERAGE_START}`);
  }
  if (!Number.isFinite(Date.parse(data.generatedAt)) || typeof data.source !== 'string' || !data.source.trim()) {
    fail('missing source or generation date');
  }
  if (!Array.isArray(data.draws) || data.draws.length !== data.latestDraw - data.coverageStart + 1) {
    fail('incomplete draw results');
  }
  const drawIds = new Set();
  for (const draw of data.draws) {
    if (!draw || !Number.isInteger(draw.draw) || draw.draw < data.coverageStart
      || draw.draw > data.latestDraw || drawIds.has(draw.draw)) fail('invalid or duplicate draw');
    drawIds.add(draw.draw);
    const balls = [...(Array.isArray(draw.numbers) ? draw.numbers : []), draw.bonus];
    if (balls.length !== 7 || new Set(balls).size !== 7
      || balls.some((ball) => !Number.isInteger(ball) || ball < 1 || ball > 45)) fail(`draw ${draw.draw}: invalid numbers`);
    if (typeof draw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(draw.date)
      || !Number.isFinite(Date.parse(draw.date))) fail(`draw ${draw.draw}: invalid date`);
    for (const field of ['firstPrize', 'secondPrize', 'firstWinners', 'secondWinners']) {
      if (!Number.isSafeInteger(draw[field]) || draw[field] < 0) fail(`draw ${draw.draw}: invalid ${field}`);
    }
  }
  if (!Array.isArray(data.stores) || !data.stores.length) fail('no mapped stores');
  const storeIds = new Set();
  const mappedDraws = new Set();
  for (const store of data.stores) {
    if (!store || typeof store.id !== 'string' || !store.id || storeIds.has(store.id)) fail('invalid or duplicate store');
    storeIds.add(store.id);
    for (const field of ['name', 'address', 'region']) {
      if (typeof store[field] !== 'string' || !store[field].trim()) fail(`store ${store.id}: missing ${field}`);
    }
    if (!Number.isFinite(store.lat) || store.lat < 32 || store.lat > 39.5
      || !Number.isFinite(store.lng) || store.lng < 124 || store.lng > 132.5) fail(`store ${store.id}: invalid coordinates`);
    if (/인터넷\s*복권판매사이트/i.test(`${store.name} ${store.address}`)) fail('online seller cannot have a map marker');
    if (!Array.isArray(store.wins) || !store.wins.length) fail(`store ${store.id}: no wins`);
    const winKeys = new Set();
    for (const win of store.wins) {
      if (!win || !drawIds.has(win.draw) || (win.rank !== 1 && win.rank !== 2)
        || typeof win.method !== 'string' || !Number.isSafeInteger(win.tickets) || win.tickets < 1) {
        fail(`store ${store.id}: invalid win`);
      }
      const key = `${win.draw}|${win.rank}|${win.method}`;
      if (winKeys.has(key)) fail(`store ${store.id}: duplicate win`);
      winKeys.add(key);
      mappedDraws.add(win.draw);
    }
  }
  for (const draw of drawIds) {
    if (!mappedDraws.has(draw)) fail(`draw ${draw}: missing store history`);
  }
}
