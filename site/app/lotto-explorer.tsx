'use client';

import type { ComponentType } from 'react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
  Layers3,
  MapPinned,
  Search,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { STORE_COVERAGE_START, validateLottoMapData } from '@/lib/lotto-data.mjs';
import type { LottoDraw, LottoMapData, RankFilter, VisibleStore } from './lotto-types';

type MapComponent = ComponentType<{
  stores: VisibleStore[];
  draws: Record<number, LottoDraw>;
  selectedStoreId: string | null;
  onSelectStore: (id: string | null) => void;
}>;

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema: object;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      execute: (input: unknown) => object | Promise<object>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

type ToolState = {
  data: LottoMapData;
  selectedRound: string;
  rankFilter: RankFilter;
  query: string;
  deferredQuery: string;
  isFullData: boolean;
};

function compactMoney(amount: number) {
  if (amount >= 100_000_000) return `${(amount / 100_000_000).toFixed(amount >= 1_000_000_000 ? 1 : 0)}억원`;
  if (amount >= 10_000) return `${Math.round(amount / 10_000).toLocaleString('ko-KR')}만원`;
  return `${amount.toLocaleString('ko-KR')}원`;
}

function ballTone(number: number) {
  if (number <= 10) return 'yellow';
  if (number <= 20) return 'blue';
  if (number <= 30) return 'red';
  if (number <= 40) return 'gray';
  return 'green';
}

function countFilteredStores(data: LottoMapData, selectedRound: string, rankFilter: RankFilter, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
  let stores = 0;
  let tickets = 0;

  data.stores.forEach((store) => {
    if (normalizedQuery
      && !`${store.name} ${store.address} ${store.region}`.toLocaleLowerCase('ko-KR').includes(normalizedQuery)) return;
    const matchingWins = store.wins.filter((win) => (
      (selectedRound === 'all' || win.draw === Number(selectedRound))
      && (rankFilter === 'all' || win.rank === Number(rankFilter))
    ));
    if (!matchingWins.length) return;
    stores += 1;
    tickets += matchingWins.reduce((sum, win) => sum + win.tickets, 0);
  });

  return { stores, tickets };
}

function parseMapToolInput(input: unknown, data: LottoMapData) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('입력은 객체여야 합니다.');
  }
  const value = input as Record<string, unknown>;
  const unknownKeys = Object.keys(value).filter((key) => !['draw', 'rank', 'query'].includes(key));
  if (unknownKeys.length) throw new Error(`지원하지 않는 필드: ${unknownKeys.join(', ')}`);

  if (value.draw !== undefined && value.draw !== 'all'
    && (!Number.isInteger(value.draw) || Number(value.draw) < data.coverageStart || Number(value.draw) > data.latestDraw)) {
    throw new Error(`draw는 'all' 또는 ${data.coverageStart}–${data.latestDraw} 사이의 회차여야 합니다.`);
  }
  if (value.rank !== undefined && !['all', 1, 2].includes(value.rank as string | number)) {
    throw new Error("rank는 'all', 1, 2 중 하나여야 합니다.");
  }
  if (value.query !== undefined && (typeof value.query !== 'string' || value.query.length > 80)) {
    throw new Error('query는 80자 이하 문자열이어야 합니다.');
  }

  return value as { draw?: 'all' | number; rank?: 'all' | 1 | 2; query?: string };
}

export function LottoExplorer() {
  const [data, setData] = useState<LottoMapData>({
    generatedAt: '', coverageStart: STORE_COVERAGE_START, latestDraw: STORE_COVERAGE_START,
    source: '동행복권 공개 데이터', draws: [], stores: [],
  });
  const [dataStatus, setDataStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [MapView, setMapView] = useState<MapComponent | null>(null);
  const [mapError, setMapError] = useState(false);
  const [selectedRound, setSelectedRound] = useState('all');
  const [rankFilter, setRankFilter] = useState<RankFilter>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const isFullData = dataStatus === 'ready';
  const toolState = useRef<ToolState>({ data, selectedRound, rankFilter, query, deferredQuery, isFullData });

  useEffect(() => {
    toolState.current = { data, selectedRound, rankFilter, query, deferredQuery, isFullData };
  }, [data, deferredQuery, isFullData, query, rankFilter, selectedRound]);

  useEffect(() => {
    let active = true;
    void import('./lotto-map').then((module) => {
      if (active) setMapView(() => module.LottoMap);
    }).catch(() => {
      if (active) setMapError(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let active = true;
    fetch('/data/lotto-map-data.json', { signal: controller.signal, cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error('full dataset not available');
        return response.json() as Promise<unknown>;
      })
      .then((dataset) => {
        validateLottoMapData(dataset);
        if (active) {
          setData(dataset);
          setDataStatus('ready');
        }
      })
      .catch(() => {
        if (active) setDataStatus('error');
      })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [loadAttempt]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return undefined;
    const lifecycle = new AbortController();

    const reportRegistrationError = (error: unknown) => {
      console.warn('WebMCP 도구를 등록하지 못했습니다.', error);
    };

    const registerTools = async () => {
      await context.registerTool({
        name: 'configure_lotto_map',
        title: '로또 지도 필터 설정',
        description: '보이는 로또 당첨판매점을 회차, 당첨 등수, 판매점·주소 검색어로 필터링합니다.',
        inputSchema: {
          type: 'object',
          properties: {
            draw: { anyOf: [{ type: 'integer' }, { const: 'all' }], description: "회차 번호 또는 전체 회차를 뜻하는 'all'" },
            rank: { enum: ['all', 1, 2], description: '전체, 1등 또는 2등' },
            query: { type: 'string', maxLength: 80, description: '판매점명·주소 검색어. 빈 문자열이면 검색을 해제합니다.' },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          const current = toolState.current;
          const parsed = parseMapToolInput(input, current.data);
          const nextRound = parsed.draw === undefined ? current.selectedRound : String(parsed.draw);
          const nextRank = parsed.rank === undefined ? current.rankFilter : String(parsed.rank) as RankFilter;
          const nextQuery = parsed.query === undefined ? current.query : parsed.query;

          toolState.current = { ...current, selectedRound: nextRound, rankFilter: nextRank, query: nextQuery };
          setSelectedRound(nextRound);
          setRankFilter(nextRank);
          setQuery(nextQuery);
          setSelectedStoreId(null);
          for (let frame = 0; frame < 30; frame += 1) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            if (toolState.current.deferredQuery === nextQuery) break;
          }

          return {
            draw: nextRound,
            rank: nextRank,
            query: nextQuery,
            ...countFilteredStores(current.data, nextRound, nextRank, nextQuery),
          };
        },
      }, { signal: lifecycle.signal });

      await context.registerTool({
        name: 'read_lotto_map_state',
        title: '로또 지도 상태 읽기',
        description: '현재 로또 지도 필터와 그 조건에 맞는 판매점·당첨 건수를 읽습니다.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input) {
          if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length) {
            throw new Error('이 도구는 빈 객체만 받습니다.');
          }
          const current = toolState.current;
          return {
            draw: current.selectedRound,
            rank: current.rankFilter,
            query: current.query,
            fullDatasetLoaded: current.isFullData,
            ...countFilteredStores(current.data, current.selectedRound, current.rankFilter, current.query),
          };
        },
      }, { signal: lifecycle.signal });
    };

    void registerTools().catch(reportRegistrationError);
    return () => lifecycle.abort();
  }, []);

  const draws = useMemo(
    () => Object.fromEntries(data.draws.map((draw) => [draw.draw, draw])),
    [data.draws],
  );

  const storeSearchIndex = useMemo(() => new Map(
    data.stores.map((store) => [
      store.id,
      `${store.name} ${store.address} ${store.region}`.toLocaleLowerCase('ko-KR'),
    ]),
  ), [data.stores]);

  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase('ko-KR');
  const visibleStores = useMemo<VisibleStore[]>(() => {
    const result: VisibleStore[] = [];
    for (const store of data.stores) {
      if (normalizedQuery && !storeSearchIndex.get(store.id)?.includes(normalizedQuery)) continue;
      const visibleWins = store.wins.filter((win) => (
        (selectedRound === 'all' || win.draw === Number(selectedRound))
        && (rankFilter === 'all' || win.rank === Number(rankFilter))
      ));
      if (visibleWins.length) result.push({ ...store, visibleWins });
    }
    return result;
  }, [data.stores, normalizedQuery, rankFilter, selectedRound, storeSearchIndex]);

  const listedStores = useMemo(() => [...visibleStores].sort((a, b) => (
      b.visibleWins.reduce((sum, win) => sum + win.tickets, 0)
      - a.visibleWins.reduce((sum, win) => sum + win.tickets, 0)
    )).slice(0, 80), [visibleStores]);

  const effectiveSelectedStoreId = selectedStoreId
    && visibleStores.some((store) => store.id === selectedStoreId)
    ? selectedStoreId
    : null;

  const activeDraw = selectedRound === 'all'
    ? draws[data.latestDraw]
    : draws[Number(selectedRound)];
  const totalWins = visibleStores.reduce((sum, store) => (
    sum + store.visibleWins.reduce((storeSum, win) => storeSum + win.tickets, 0)
  ), 0);
  const sortedDraws = useMemo(() => [...data.draws].sort((a, b) => b.draw - a.draw), [data.draws]);

  const nudgeRound = (delta: number) => {
    const current = selectedRound === 'all' ? data.latestDraw : Number(selectedRound);
    const next = Math.max(data.coverageStart, Math.min(data.latestDraw, current + delta));
    setSelectedRound(String(next));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><span>6</span><span>45</span></span>
          <div>
            <strong>로또 스팟</strong>
            <span>당첨판매점 아카이브</span>
          </div>
        </div>
        <div className="source-chip">
          <span className="source-pulse" aria-hidden="true" />
          {dataStatus === 'ready'
            ? `${data.coverageStart}–${data.latestDraw}회 데이터`
            : dataStatus === 'loading' ? '전체 데이터 불러오는 중' : '전체 데이터 연결 실패'}
        </div>
        <a className="official-link" href="https://www.dhlottery.co.kr/wnprchsplcsrch/home" target="_blank" rel="noreferrer">
          동행복권 원문 <ExternalLink aria-hidden="true" />
        </a>
      </header>

      <div className="workspace">
        <aside className="control-panel">
          <div className="panel-intro">
            <p className="eyebrow"><MapPinned aria-hidden="true" /> LOTTO 6/45 MAP</p>
            <h1>당첨판매점을<br />지도에서 한눈에</h1>
            <p>전체 회차의 당첨판매점을 한 번에 표시합니다. 마커를 누르면 판매점의 회차별 당첨 기록을 확인할 수 있습니다.</p>
          </div>

          {dataStatus !== 'ready' && (
            <div className="data-notice" role={dataStatus === 'error' ? 'alert' : 'status'}>
              <strong>{dataStatus === 'loading' ? '전체 회차의 판매점을 불러오는 중입니다' : '전체 당첨판매점 데이터를 불러오지 못했습니다'}</strong>
              {dataStatus === 'error' && (
                <Button variant="outline" size="sm" onClick={() => { setDataStatus('loading'); setLoadAttempt((attempt) => attempt + 1); }}>데이터 다시 불러오기</Button>
              )}
            </div>
          )}

          {activeDraw && (
            <section className="draw-card" aria-label={`${activeDraw.draw}회 당첨 정보`}>
              <div className="draw-card-heading">
                <div>
                  <span>{selectedRound === 'all' ? '가장 최근 추첨' : '선택한 추첨'}</span>
                  <strong>{activeDraw.draw}회</strong>
                </div>
                <time dateTime={activeDraw.date}>{activeDraw.date.replaceAll('-', '. ')}</time>
              </div>
              <div className="number-row number-row-large">
                {activeDraw.numbers.map((number) => (
                  <span className={`lotto-ball ball-${ballTone(number)}`} key={number}>{number}</span>
                ))}
                <span className="number-plus">+</span>
                <span className={`lotto-ball ball-${ballTone(activeDraw.bonus)}`}>{activeDraw.bonus}</span>
              </div>
              <div className="prize-strip">
                <span><i className="rank-dot rank-dot-first" />1등 <strong>{compactMoney(activeDraw.firstPrize)}</strong></span>
                <span><i className="rank-dot rank-dot-second" />2등 <strong>{compactMoney(activeDraw.secondPrize)}</strong></span>
              </div>
            </section>
          )}

          <section className="filter-section" aria-label="지도 필터">
            <div className="filter-label-row"><label htmlFor="round-select">회차</label><span>{isFullData ? `${data.draws.length.toLocaleString('ko-KR')}개 회차` : '데이터 확인 중'}</span></div>
            <div className="round-control">
              <Button variant="outline" size="icon-lg" aria-label="이전 회차" onClick={() => nudgeRound(-1)} disabled={!isFullData || (selectedRound !== 'all' && Number(selectedRound) <= data.coverageStart)}>
                <ChevronLeft />
              </Button>
              <NativeSelect id="round-select" className="round-select" disabled={!isFullData} value={selectedRound} onChange={(event) => setSelectedRound(event.target.value)}>
                <NativeSelectOption value="all">{isFullData ? `전체 회차 (${data.coverageStart}–${data.latestDraw}회)` : '전체 회차'}</NativeSelectOption>
                {sortedDraws.map((draw) => <NativeSelectOption key={draw.draw} value={String(draw.draw)}>{draw.draw}회 · {draw.date.slice(0, 4)}</NativeSelectOption>)}
              </NativeSelect>
              <Button variant="outline" size="icon-lg" aria-label="다음 회차" onClick={() => nudgeRound(1)} disabled={!isFullData || selectedRound === 'all' || Number(selectedRound) >= data.latestDraw}>
                <ChevronRight />
              </Button>
            </div>

            {isFullData && <p className="coverage-note">{selectedRound === 'all' ? `${data.coverageStart}–${data.latestDraw}회 누적 판매점을 표시 중입니다.` : `${selectedRound}회 판매점을 표시 중입니다.`}</p>}

            <div className="filter-label-row"><span id="rank-label">당첨 등수</span></div>
            <Tabs value={rankFilter} onValueChange={(value) => setRankFilter(value as RankFilter)} aria-labelledby="rank-label">
              <TabsList className="rank-tabs">
                <TabsTrigger value="all">전체</TabsTrigger>
                <TabsTrigger value="1"><i className="rank-dot rank-dot-first" />1등</TabsTrigger>
                <TabsTrigger value="2"><i className="rank-dot rank-dot-second" />2등</TabsTrigger>
              </TabsList>
            </Tabs>

            <label className="search-box" htmlFor="store-search">
              <Search aria-hidden="true" />
              <Input id="store-search" aria-label="판매점명 또는 주소 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="판매점·주소 검색" />
            </label>
          </section>

          <section className="results-section">
            <div className="results-heading">
              <div><Layers3 aria-hidden="true" /><span>지도 표시</span></div>
              <output aria-live="polite" aria-atomic="true">{visibleStores.length.toLocaleString('ko-KR')}곳 <small>· {totalWins.toLocaleString('ko-KR')}건</small></output>
            </div>
            <div className="store-list">
              {listedStores.map((store) => {
                const hasFirst = store.visibleWins.some((win) => win.rank === 1);
                const hasSecond = store.visibleWins.some((win) => win.rank === 2);
                return (
                  <button className={`store-item ${effectiveSelectedStoreId === store.id ? 'is-selected' : ''}`} aria-pressed={effectiveSelectedStoreId === store.id} key={store.id} onClick={() => setSelectedStoreId(store.id)}>
                    <span className={`store-rank-badge ${hasFirst && hasSecond ? 'rank-both' : hasFirst ? 'rank-first' : 'rank-second'}`}>
                      {hasFirst && hasSecond ? '1+2' : hasFirst ? '1' : '2'}
                    </span>
                    <span className="store-copy"><strong>{store.name}</strong><small>{store.address}</small></span>
                    <span className="store-count">{store.visibleWins.reduce((sum, win) => sum + win.tickets, 0)}건</span>
                  </button>
                );
              })}
              {visibleStores.length === 0 && <div className="empty-result">{isFullData ? '조건에 맞는 판매점이 없습니다.' : dataStatus === 'loading' ? '판매점 기록을 불러오는 중입니다.' : '데이터를 다시 불러와 주세요.'}</div>}
              {visibleStores.length > 80 && <p className="list-limit">지도에는 전체를 표시하며 목록은 상위 80곳만 보여줍니다.</p>}
            </div>
          </section>

          <footer className="panel-footer">
            <Database aria-hidden="true" />
            <p><strong>{data.source}</strong><span>판매점 기록은 공식 조회가 제공되는 {STORE_COVERAGE_START}회부터입니다. 인터넷 판매점과 좌표가 없는 기록은 지도에서 제외됩니다. 위치는 가장 최근 공개 주소 기준입니다.</span></p>
          </footer>
        </aside>

        <section className="map-stage" aria-label="로또 당첨판매점 지도">
          <div className="map-status-card">
            <span><Sparkles aria-hidden="true" />{isFullData ? selectedRound === 'all' ? `전체 ${data.draws.length}개 회차 누적` : `${selectedRound}회 당첨 기록` : dataStatus === 'error' ? '전체 데이터 연결 실패' : '전체 회차 데이터 확인 중'}</span>
            <strong>{isFullData ? visibleStores.length.toLocaleString('ko-KR') : '—'}</strong><small>개 판매점</small>
          </div>
          <div className="map-legend" aria-label="마커 범례">
            <span><i className="legend-pin legend-first" />1등</span>
            <span><i className="legend-pin legend-second" />2등</span>
            <span><i className="legend-pin legend-both" />중복</span>
          </div>
          {MapView ? (
            <MapView stores={visibleStores} draws={draws} selectedStoreId={effectiveSelectedStoreId} onSelectStore={setSelectedStoreId} />
          ) : mapError ? (
            <div className="map-loading map-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <span>지도를 불러오지 못했습니다</span>
              <Button variant="outline" onClick={() => window.location.reload()}>다시 시도</Button>
            </div>
          ) : (
            <div className="map-loading"><Trophy aria-hidden="true" /><span>지도를 불러오는 중입니다</span></div>
          )}
        </section>
      </div>
    </main>
  );
}
