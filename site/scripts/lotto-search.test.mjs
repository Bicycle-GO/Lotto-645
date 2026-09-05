import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesArea,
  matchesSearch,
  searchText,
  storeArea,
} from '../lib/lotto-search.mjs';

test('regions disambiguate identical district names and include legacy Gwangju addresses', () => {
  const store = {
    name: '복권방',
    region: '전남광주',
    address: '전남광주 서구 상무대로 1087',
  };
  assert.deepEqual(storeArea(store), { region: '광주', district: '서구' });
  assert.equal(matchesArea(store, '광주', '서구'), true);
  assert.equal(matchesArea(store, '대전', '서구'), false);
  assert.equal(matchesSearch(searchText(store), '광주광역시 서구'), true);
  assert.equal(
    matchesSearch(
      searchText({
        name: '복권방',
        region: '전남광주',
        address: '전남광주 해남군 해남로 34',
      }),
      '광주',
    ),
    false,
  );
  assert.deepEqual(
    storeArea({ region: '전남광주', address: '전남광주 해남군 해남로 34' }),
    { region: '전남', district: '해남군' },
  );
});

test('districts keep city and ward together, while Sejong has no district level', () => {
  assert.deepEqual(
    storeArea({ region: '경기', address: '경기 수원시 영통구 광교로 1' }),
    { region: '경기', district: '수원시 영통구' },
  );
  assert.deepEqual(
    storeArea({ region: '세종', address: '세종 조치원읍 새내로 1' }),
    { region: '세종', district: '' },
  );
  assert.deepEqual(
    storeArea({ region: '충남', address: '충남 금산군 후곤천길 77' }),
    { region: '충남', district: '금산군' },
  );
});

test('search supports full province names, separated words, whitespace and no results', () => {
  const text = searchText({
    name: '행운복권',
    region: '경기',
    address: '경기 수원시 영통구 광교로 1',
  });
  assert.equal(matchesSearch(text, '  경기도   영통구 행운  '), true);
  assert.equal(matchesSearch(text, '서울 행운'), false);
  assert.equal(matchesSearch(text, ''), true);
});
