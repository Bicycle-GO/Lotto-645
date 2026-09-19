import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateLottoMapData } from '../lib/lotto-data.mjs';
import { buildStores, extendArchive } from './build-lotto-data.mjs';

function archive() {
  return {
    generatedAt: '2026-09-05T00:00:00Z', coverageStart: 262, latestDraw: 264,
    source: 'Test fixture',
    draws: [264, 263, 262].map((draw) => ({
      draw, date: '2007-12-08', numbers: [1, 2, 3, 4, 5, 6], bonus: 7,
      firstPrize: 1000, secondPrize: 100, firstWinners: 2, secondWinners: 10,
    })),
    stores: [{
      id: 'test-store', name: '테스트 판매점', address: '서울 테스트 주소', region: '서울',
      lat: 37.5, lng: 127,
      wins: [
        { draw: 262, rank: 1, method: '자동', tickets: 2 },
        { draw: 263, rank: 2, method: '', tickets: 1 },
        { draw: 264, rank: 1, method: '수동', tickets: 1 },
        { draw: 264, rank: 2, method: '', tickets: 1 },
      ],
    }],
  };
}

test('accepts complete history with repeated wins and both ranks at one store', () => {
  assert.doesNotThrow(() => validateLottoMapData(archive()));
});

test('rejects a latest-only preview even if labelled as successfully loaded', () => {
  const data = archive();
  data.coverageStart = 264;
  data.draws = data.draws.slice(0, 1);
  data.stores[0].wins = data.stores[0].wins.filter((win) => win.draw === 264);
  assert.throws(() => validateLottoMapData(data), /coverage must begin/);
});

test('rejects complete draw results backed by only recent store history', () => {
  const data = archive();
  data.stores[0].wins = data.stores[0].wins.filter((win) => win.draw === 264);
  assert.throws(() => validateLottoMapData(data), /missing store history/);
});

test('rejects a missing intermediate draw and duplicates that disguise a gap', () => {
  const data = archive();
  data.draws.splice(1, 1);
  assert.throws(() => validateLottoMapData(data), /incomplete draw results/);
  data.draws.push(data.draws[0]);
  assert.throws(() => validateLottoMapData(data), /duplicate draw/);
});

test('rejects empty or malformed data and unusable map coordinates', () => {
  for (const value of [null, {}, { ...archive(), stores: [] }]) {
    assert.throws(() => validateLottoMapData(value));
  }
  const data = archive();
  data.stores[0].lat = null;
  assert.throws(() => validateLottoMapData(data), /invalid coordinates/);
});

test('rejects duplicate wins, unknown draws, invalid ranks and ticket counts', () => {
  const duplicate = archive();
  duplicate.stores[0].wins.push(duplicate.stores[0].wins[0]);
  assert.throws(() => validateLottoMapData(duplicate), /duplicate win/);
  for (const override of [{ draw: 265 }, { rank: 3 }, { tickets: 0 }]) {
    const data = archive();
    Object.assign(data.stores[0].wins[0], override);
    assert.throws(() => validateLottoMapData(data), /invalid win/);
  }
});

test('merges historical shops, counts tickets and retains unnamed historical sellers', () => {
  const row = { ltShpId: 'shop', shpNm: '', shpAddr: '서울 옛 주소', region: '서울', shpLat: 37.5, shpLot: 127, wnShpRnk: 1, atmtPsvYnTxt: '자동' };
  const { stores } = buildStores(new Map([
    [264, [{ ...row, shpNm: '현재 이름', shpAddr: '서울 새 주소', shpLat: 37.6, wnShpRnk: 2 }]],
    [262, [row, row, { ...row, ltShpId: 'unnamed' }]],
  ]));
  assert.equal(stores.length, 2);
  const shop = stores.find((store) => store.id === 'shop');
  assert.equal(shop.name, '현재 이름');
  assert.equal(shop.address, '서울 새 주소');
  assert.equal(shop.lat, 37.6);
  assert.equal(shop.wins.find((win) => win.draw === 262).tickets, 2);
  assert.deepEqual(shop.wins.map((win) => win.draw), [264, 262]);
  assert.equal(stores.find((store) => store.id === 'unnamed').name, '이름 미제공 판매점');
});

test('excludes internet sellers and unusable coordinates from map markers', () => {
  const row = { ltShpId: 'shop', shpNm: '테스트', shpAddr: '서울 주소', region: '서울', shpLat: 37.5, shpLot: 127, wnShpRnk: 1 };
  const result = buildStores(new Map([[262, [row,
    { ...row, ltShpId: 'online', shpNm: '인터넷 복권판매사이트' },
    { ...row, ltShpId: 'missing-location', shpLat: null },
  ]]]));
  assert.equal(result.stores.length, 1);
  assert.equal(result.exclusions.onlineRows, 1);
  assert.equal(result.exclusions.invalidCoordinateRows, 1);
});

test('appends new draws without losing old tickets or stores, using latest shop locations', () => {
  const previous = archive();
  previous.stores[0].phone = '02-123-4567';
  const original = structuredClone(previous);
  const draw = { ...previous.draws[0], draw: 265 };
  const row = { ltShpId: 'test-store', shpNm: '', shpAddr: '서울 새 주소', region: '서울', shpLat: 37.6, shpLot: 127.1, wnShpRnk: 1, atmtPsvYnTxt: '자동' };
  const updated = extendArchive(previous, [draw], new Map([[265, [row, row,
    { ...row, ltShpId: 'new-store', shpNm: '신규 판매점', wnShpRnk: 2 },
    { ...row, ltShpId: 'online', shpNm: '인터넷 복권판매사이트' },
  ]]]));
  const shop = updated.stores.find((store) => store.id === 'test-store');
  assert.deepEqual(previous, original);
  assert.equal(updated.latestDraw, 265);
  assert.deepEqual(updated.draws.slice(1), original.draws);
  assert.deepEqual(shop.wins.slice(1), original.stores[0].wins);
  assert.equal(shop.wins[0].tickets, 2);
  assert.equal(shop.name, '테스트 판매점');
  assert.equal(shop.phone, '02-123-4567');
  assert.equal(shop.address, '서울 새 주소');
  assert.equal(shop.lat, 37.6);
  assert.equal(updated.stores.length, 2);
});

test('refuses gaps, repeated draws and missing mapped stores during an update', () => {
  const previous = archive();
  const draw = { ...previous.draws[0], draw: 265 };
  const row = { ltShpId: 'new', shpNm: '판매점', shpAddr: '서울 주소', region: '서울', shpLat: 37.5, shpLot: 127, wnShpRnk: 1 };
  assert.throws(() => extendArchive(previous, [previous.draws[0]], new Map()), /only new draws/);
  assert.throws(() => extendArchive(previous, [draw, draw], new Map([[265, [row]]])), /incomplete draw results/);
  assert.throws(() => extendArchive(previous, [{ ...draw, draw: 266 }], new Map([[266, [row]]])), /incomplete draw results/);
  assert.throws(() => extendArchive(previous, [draw], new Map()), /same draws/);
  assert.throws(() => extendArchive(previous, [draw], new Map([[265, []]])), /missing store history/);
});
