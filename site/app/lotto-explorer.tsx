'use client';

import type { ComponentType } from 'react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  X,
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
  Layers3,
  MapPinned,
  Search,
  Sparkles,
  Trophy,
  LocateFixed,
  LocateOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  STORE_COVERAGE_START,
  validateLottoMapData,
} from '@/lib/lotto-data.mjs';
import {
  REGION_NAMES,
  matchesArea,
  matchesSearch,
  searchText,
  distanceMeters,
  storeArea,
} from '@/lib/lotto-search.mjs';
import type {
  MapFocus,
  LottoDraw,
  LottoMapData,
  RankFilter,
  VisibleStore,
} from './lotto-types';
import { useIsMobile } from '@/hooks/use-mobile';

type NearbyStore = VisibleStore & {
  distanceFromUser: number | null;
};

type MapComponent = ComponentType<{
  stores: VisibleStore[];
  focus: MapFocus;
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
  region: string;
  district: string;
  isFullData: boolean;
  isNearbySearchEnabled: boolean;
  nearbyRadiusMeters: number;
  userLatitude: number | null;
  userLongitude: number | null;
};

function compactMoney(amount: number) {
  if (amount >= 100_000_000)
    return `${(amount / 100_000_000).toFixed(amount >= 1_000_000_000 ? 1 : 0)}억원`;
  if (amount >= 10_000)
    return `${Math.round(amount / 10_000).toLocaleString('ko-KR')}만원`;
  return `${amount.toLocaleString('ko-KR')}원`;
}

function ballTone(number: number) {
  if (number <= 10) return 'yellow';
  if (number <= 20) return 'blue';
  if (number <= 30) return 'red';
  if (number <= 40) return 'gray';
  return 'green';
}

function formatDistance(distance: number | null) {
  if (distance === null || !Number.isFinite(distance)) return null;
  if (distance < 1000) return `${Math.round(distance)}m`;
  return `${(distance / 1000).toFixed(1)}km`;
}

function countFilteredStores(
  data: LottoMapData,
  selectedRound: string,
  rankFilter: RankFilter,
  query: string,
  region = 'all',
  district = 'all',
  isNearbySearchEnabled = false,
  userLatitude = null as number | null,
  userLongitude = null as number | null,
  nearbyRadiusMeters = null as number | null,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
  let stores = 0;
  let tickets = 0;
  const useNearbyFilter =
    isNearbySearchEnabled &&
    userLatitude !== null &&
    userLongitude !== null &&
    nearbyRadiusMeters !== null &&
    Number.isFinite(nearbyRadiusMeters);

  data.stores.forEach((store) => {
    if (
      !matchesArea(store, region, district) ||
      !matchesSearch(searchText(store), normalizedQuery)
    )
      return;
    if (
      useNearbyFilter &&
      distanceMeters(userLatitude, userLongitude, store.lat, store.lng) >
        nearbyRadiusMeters
    )
      return;
    const matchingWins = store.wins.filter(
      (win) =>
        (selectedRound === 'all' || win.draw === Number(selectedRound)) &&
        (rankFilter === 'all' || win.rank === Number(rankFilter)),
    );
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
  const unknownKeys = Object.keys(value).filter(
    (key) => !['draw', 'rank', 'query'].includes(key),
  );
  if (unknownKeys.length)
    throw new Error(`지원하지 않는 필드: ${unknownKeys.join(', ')}`);

  if (
    value.draw !== undefined &&
    value.draw !== 'all' &&
    (!Number.isInteger(value.draw) ||
      Number(value.draw) < data.coverageStart ||
      Number(value.draw) > data.latestDraw)
  ) {
    throw new Error(
      `draw는 'all' 또는 ${data.coverageStart}–${data.latestDraw} 사이의 회차여야 합니다.`,
    );
  }
  if (
    value.rank !== undefined &&
    !['all', 1, 2].includes(value.rank as string | number)
  ) {
    throw new Error("rank는 'all', 1, 2 중 하나여야 합니다.");
  }
  if (
    value.query !== undefined &&
    (typeof value.query !== 'string' || value.query.length > 80)
  ) {
    throw new Error('query는 80자 이하 문자열이어야 합니다.');
  }

  return value as {
    draw?: 'all' | number;
    rank?: 'all' | 1 | 2;
    query?: string;
  };
}

export function LottoExplorer() {
  const [data, setData] = useState<LottoMapData>({
    generatedAt: '',
    coverageStart: STORE_COVERAGE_START,
    latestDraw: STORE_COVERAGE_START,
    source: '동행복권 공개 데이터',
    draws: [],
    stores: [],
  });
  const [dataStatus, setDataStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [MapView, setMapView] = useState<MapComponent | null>(null);
  const [mapError, setMapError] = useState(false);
  const [selectedRound, setSelectedRound] = useState('all');
  const [rankFilter, setRankFilter] = useState<RankFilter>('all');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('all');
  const [district, setDistrict] = useState('all');
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [topHidden, setTopHidden] = useState(false);
  const [bottomHidden, setBottomHidden] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [focusRevision, setFocusRevision] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [isNearbySearchEnabled, setIsNearbySearchEnabled] = useState(false);
  const [nearbyRadiusMeters, setNearbyRadiusMeters] = useState(500);
  const [userLatitude, setUserLatitude] = useState<number | null>(null);
  const [userLongitude, setUserLongitude] = useState<number | null>(null);
  const [locationError, setLocationError] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const isMobile = useIsMobile();
  const selectStore = useCallback((id: string | null) => {
    setSelectedStoreId(id);
    if (id) {
      setBottomHidden(false);
      setResultsOpen(false);
      setFiltersOpen(false);
    }
  }, []);
  const isFullData = dataStatus === 'ready';
  const toolState = useRef<ToolState>({
    data,
    selectedRound,
    rankFilter,
    query,
    deferredQuery,
    region,
    district,
    isFullData,
    isNearbySearchEnabled,
    nearbyRadiusMeters,
    userLatitude,
    userLongitude,
  });

  useEffect(() => {
    toolState.current = {
      data,
      selectedRound,
      rankFilter,
      query,
      deferredQuery,
      region,
      district,
      isFullData,
      isNearbySearchEnabled,
      nearbyRadiusMeters,
      userLatitude,
      userLongitude,
    };
  }, [
    data,
    deferredQuery,
    district,
    isFullData,
    query,
    rankFilter,
    region,
    selectedRound,
    isNearbySearchEnabled,
    nearbyRadiusMeters,
    userLatitude,
    userLongitude,
  ]);

  useEffect(() => {
    let active = true;
    void import('./lotto-map')
      .then((module) => {
        if (active) setMapView(() => module.LottoMap);
      })
      .catch(() => {
        if (active) setMapError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let active = true;
    fetch('/data/lotto-map-data.json', {
      signal: controller.signal,
      cache: 'no-cache',
    })
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
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [loadAttempt]);

  const useNearbyFilter =
    isMobile &&
    isNearbySearchEnabled &&
    userLatitude !== null &&
    userLongitude !== null;

  const locationErrorMessage = (error: GeolocationPositionError) => {
    if (error.code === error.PERMISSION_DENIED)
      return '위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해 주세요.';
    if (error.code === error.POSITION_UNAVAILABLE)
      return '현재 위치를 확인할 수 없습니다.';
    if (error.code === error.TIMEOUT)
      return '위치 확인 시간이 초과되었습니다.';
    return '현재 위치를 가져오지 못했습니다.';
  };

  const requestMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocationError('이 브라우저는 위치 정보를 지원하지 않습니다.');
      setIsNearbySearchEnabled(false);
      return;
    }
    setIsLocating(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsNearbySearchEnabled(true);
        setUserLatitude(position.coords.latitude);
        setUserLongitude(position.coords.longitude);
        setIsLocating(false);
      },
      (error) => {
        setIsLocating(false);
        setIsNearbySearchEnabled(false);
        setLocationError(locationErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 2_000,
      },
    );
  };

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return undefined;
    const lifecycle = new AbortController();

    const reportRegistrationError = (error: unknown) => {
      console.warn('WebMCP 도구를 등록하지 못했습니다.', error);
    };

    const registerTools = async () => {
      await context.registerTool(
        {
          name: 'configure_lotto_map',
          title: '로또 지도 필터 설정',
          description:
            '보이는 로또 당첨판매점을 회차, 당첨 등수, 판매점·주소 검색어로 필터링합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              draw: {
                anyOf: [{ type: 'integer' }, { const: 'all' }],
                description: "회차 번호 또는 전체 회차를 뜻하는 'all'",
              },
              rank: { enum: ['all', 1, 2], description: '전체, 1등 또는 2등' },
              query: {
                type: 'string',
                maxLength: 80,
                description:
                  '판매점명·주소 검색어. 빈 문자열이면 검색을 해제합니다.',
              },
            },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute(input) {
            const current = toolState.current;
            const parsed = parseMapToolInput(input, current.data);
            const nextRound =
              parsed.draw === undefined
                ? current.selectedRound
                : String(parsed.draw);
            const nextRank =
              parsed.rank === undefined
                ? current.rankFilter
                : (String(parsed.rank) as RankFilter);
            const nextQuery =
              parsed.query === undefined ? current.query : parsed.query;

            toolState.current = {
              ...current,
              selectedRound: nextRound,
              rankFilter: nextRank,
              query: nextQuery,
            };
            setSelectedRound(nextRound);
            setRankFilter(nextRank);
            setQuery(nextQuery);
            setSelectedStoreId(null);
            for (let frame = 0; frame < 30; frame += 1) {
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
              );
              if (toolState.current.deferredQuery === nextQuery) break;
            }

            return {
              draw: nextRound,
              rank: nextRank,
              query: nextQuery,
              region: current.region,
              district: current.district,
              nearbySearchEnabled:
                current.isNearbySearchEnabled &&
                current.userLatitude !== null &&
                current.userLongitude !== null,
              nearbyRadiusMeters: current.nearbyRadiusMeters,
              ...countFilteredStores(
                current.data,
                nextRound,
                nextRank,
                nextQuery,
                current.region,
                current.district,
                current.isNearbySearchEnabled &&
                  current.userLatitude !== null &&
                  current.userLongitude !== null,
                current.userLatitude,
                current.userLongitude,
                current.nearbyRadiusMeters,
              ),
            };
          },
        },
        { signal: lifecycle.signal },
      );

      await context.registerTool(
        {
          name: 'read_lotto_map_state',
          title: '로또 지도 상태 읽기',
          description:
            '현재 로또 지도 필터와 그 조건에 맞는 판매점·당첨 건수를 읽습니다.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute(input) {
            if (
              typeof input !== 'object' ||
              input === null ||
              Array.isArray(input) ||
              Object.keys(input).length
            ) {
              throw new Error('이 도구는 빈 객체만 받습니다.');
            }
            const current = toolState.current;
            return {
              draw: current.selectedRound,
              rank: current.rankFilter,
              query: current.query,
              fullDatasetLoaded: current.isFullData,
              region: current.region,
              district: current.district,
              nearbySearchEnabled:
                current.isNearbySearchEnabled &&
                current.userLatitude !== null &&
                current.userLongitude !== null,
              nearbyRadiusMeters: current.nearbyRadiusMeters,
              ...countFilteredStores(
                current.data,
                current.selectedRound,
                current.rankFilter,
                current.query,
                current.region,
                current.district,
                current.isNearbySearchEnabled &&
                  current.userLatitude !== null &&
                  current.userLongitude !== null,
                current.userLatitude,
                current.userLongitude,
                current.nearbyRadiusMeters,
              ),
            };
          },
        },
        { signal: lifecycle.signal },
      );
    };

    void registerTools().catch(reportRegistrationError);
    return () => lifecycle.abort();
  }, []);

  const draws = useMemo(
    () => Object.fromEntries(data.draws.map((draw) => [draw.draw, draw])),
    [data.draws],
  );

  const storeSearchIndex = useMemo(
    () => new Map(data.stores.map((store) => [store.id, searchText(store)])),
    [data.stores],
  );

  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase('ko-KR');
  const hasUserLocation = userLatitude !== null && userLongitude !== null;
  const nearbyRadiusClamped = Math.min(Math.max(nearbyRadiusMeters, 100), 1000);
  const visibleStores = useMemo<NearbyStore[]>(() => {
    const result: NearbyStore[] = [];
    const filteredRadiusMeters = isNearbySearchEnabled ? nearbyRadiusClamped : 0;
    for (const store of data.stores) {
      if (
        !matchesArea(store, region, district) ||
        !matchesSearch(storeSearchIndex.get(store.id) || '', normalizedQuery)
      )
        continue;
      if (
        useNearbyFilter &&
        distanceMeters(userLatitude, userLongitude, store.lat, store.lng) >
          filteredRadiusMeters
      ) {
        continue;
      }
      const visibleWins = store.wins.filter(
        (win) =>
          (selectedRound === 'all' || win.draw === Number(selectedRound)) &&
          (rankFilter === 'all' || win.rank === Number(rankFilter)),
      );
      if (!visibleWins.length) continue;
      const distanceFromUser =
        useNearbyFilter || hasUserLocation
          ? distanceMeters(userLatitude, userLongitude, store.lat, store.lng)
          : null;

      result.push({
        ...store,
        visibleWins,
        distanceFromUser:
          (useNearbyFilter || hasUserLocation) && Number.isFinite(distanceFromUser)
            ? distanceFromUser
            : null,
      });
    }
    return result;
  }, [
    data.stores,
    district,
    normalizedQuery,
    rankFilter,
    region,
    selectedRound,
    storeSearchIndex,
    isNearbySearchEnabled,
    nearbyRadiusClamped,
    useNearbyFilter,
    hasUserLocation,
    userLatitude,
    userLongitude,
  ]);

  const districts = useMemo(
    () =>
      [
        ...new Set(
          data.stores
            .filter((store) => storeArea(store).region === region)
            .map((store) => storeArea(store).district)
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b, 'ko-KR')),
    [data.stores, region],
  );

  // Area-only bounds still let users navigate when a round has no winners there.
  const focus = useMemo<MapFocus>(
    () => ({
      key: JSON.stringify([
        region,
        district,
        normalizedQuery,
        selectedRound,
        rankFilter,
        focusRevision,
      ]),
      points: (visibleStores.length
        ? visibleStores
        : useNearbyFilter && hasUserLocation
          ? [[userLatitude, userLongitude]]
        : data.stores.filter(
            (store) =>
              matchesArea(store, region, district) &&
              matchesSearch(
                storeSearchIndex.get(store.id) || '',
                normalizedQuery,
              ),
          )
      ).map((store) => [store.lat, store.lng]),
    }),
    [
      data.stores,
      district,
      focusRevision,
      normalizedQuery,
      rankFilter,
      region,
      selectedRound,
      storeSearchIndex,
      visibleStores,
    ],
  );

  const resetFilters = () => {
    setRegion('all');
    setDistrict('all');
    setQuery('');
    setSelectedRound('all');
    setRankFilter('all');
    setIsNearbySearchEnabled(false);
    setLocationError('');
    setSelectedStoreId(null);
    setFocusRevision((value) => value + 1);
  };

  const listedStores = useMemo(
    () =>
      [...visibleStores]
        .sort((a, b) => {
          if (useNearbyFilter) {
            const aDistance = a.distanceFromUser;
            const bDistance = b.distanceFromUser;
            if (aDistance !== null && bDistance !== null) return aDistance - bDistance;
            if (aDistance !== null) return -1;
            if (bDistance !== null) return 1;
          }
          return (
            b.visibleWins.reduce((sum, win) => sum + win.tickets, 0) -
            a.visibleWins.reduce((sum, win) => sum + win.tickets, 0)
          );
        })
        .slice(0, 80),
    [useNearbyFilter, visibleStores],
  );

  const effectiveSelectedStoreId =
    selectedStoreId &&
    visibleStores.some((store) => store.id === selectedStoreId)
      ? selectedStoreId
      : null;

  const activeDraw =
    selectedRound === 'all'
      ? draws[data.latestDraw]
      : draws[Number(selectedRound)];
  const totalWins = visibleStores.reduce(
    (sum, store) =>
      sum +
      store.visibleWins.reduce((storeSum, win) => storeSum + win.tickets, 0),
    0,
  );
  const sortedDraws = useMemo(
    () => [...data.draws].sort((a, b) => b.draw - a.draw),
    [data.draws],
  );

  const nudgeRound = (delta: number) => {
    const current =
      selectedRound === 'all' ? data.latestDraw : Number(selectedRound);
    const next = Math.max(
      data.coverageStart,
      Math.min(data.latestDraw, current + delta),
    );
    setSelectedRound(String(next));
    setSelectedStoreId(null);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <span>6</span>
            <span>45</span>
          </span>
          <div>
            <strong>로또 스팟</strong>
            <span>당첨판매점 아카이브</span>
          </div>
        </div>
        <div className="source-chip">
          <span className="source-pulse" aria-hidden="true" />
          {dataStatus === 'ready'
            ? `${data.coverageStart}–${data.latestDraw}회 데이터`
            : dataStatus === 'loading'
              ? '전체 데이터 불러오는 중'
              : '전체 데이터 연결 실패'}
        </div>
        <a
          className="official-link"
          href="https://www.dhlottery.co.kr/wnprchsplcsrch/home"
          target="_blank"
          rel="noreferrer"
        >
          동행복권 원문 <ExternalLink aria-hidden="true" />
        </a>
      </header>

      <div
        className={`workspace ${effectiveSelectedStoreId ? 'has-selection' : ''} ${sidebarHidden ? 'sidebar-hidden' : ''} ${topHidden ? 'top-hidden' : ''} ${bottomHidden ? 'bottom-hidden' : ''}`}
      >
        <button
          className="desktop-panel-toggle"
          aria-label={sidebarHidden ? '좌측 패널 열기' : '좌측 패널 숨기기'}
          aria-expanded={!sidebarHidden}
          aria-controls="explorer-panel"
          onClick={() => setSidebarHidden((hidden) => !hidden)}
        >
          {sidebarHidden ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
        <button
          className="mobile-top-toggle"
          aria-expanded={!topHidden}
          aria-controls="search-panel"
          onClick={() => setTopHidden((hidden) => !hidden)}
        >
          {topHidden ? <Search /> : <ChevronUp />}
          {topHidden ? '검색 패널 열기' : '상단 숨기기'}
        </button>
        <button
          className="mobile-bottom-toggle"
          aria-expanded={!bottomHidden}
          aria-controls={
            effectiveSelectedStoreId ? 'store-detail' : 'list-panel'
          }
          onClick={() => setBottomHidden((hidden) => !hidden)}
        >
          {bottomHidden ? <ChevronUp /> : <ChevronDown />}
          {bottomHidden ? '판매점 패널 열기' : '하단 숨기기'}
        </button>
        <aside
          id="explorer-panel"
          className="control-panel"
          aria-label="판매점 탐색"
        >
          <div
            id="search-panel"
            className={`top-panel ${filtersOpen ? 'filters-open' : ''}`}
          >
            <div className="panel-intro">
              <p className="eyebrow">
                <MapPinned aria-hidden="true" /> LOTTO 6/45 MAP
              </p>
              <h1>
                당첨판매점을
                <br />
                지도에서 한눈에
              </h1>
              <p>
                전체 회차의 당첨판매점을 한 번에 표시합니다. 마커를 누르면
                판매점의 회차별 당첨 기록을 확인할 수 있습니다.
              </p>
            </div>

            {dataStatus !== 'ready' && (
              <div
                className="data-notice"
                role={dataStatus === 'error' ? 'alert' : 'status'}
              >
                <strong>
                  {dataStatus === 'loading'
                    ? '전체 회차의 판매점을 불러오는 중입니다'
                    : '전체 당첨판매점 데이터를 불러오지 못했습니다'}
                </strong>
                {dataStatus === 'error' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDataStatus('loading');
                      setLoadAttempt((attempt) => attempt + 1);
                    }}
                  >
                    데이터 다시 불러오기
                  </Button>
                )}
              </div>
            )}

            <section className="filter-section" aria-label="지도 필터">
              <form
                className="search-toolbar"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSelectedStoreId(null);
                  setFocusRevision((value) => value + 1);
                  setFiltersOpen(false);
                }}
              >
                <label className="search-box" htmlFor="store-search">
                  <Search aria-hidden="true" />
                  <Input
                    id="store-search"
                    aria-label="지역, 판매점명 또는 주소 검색"
                    value={query}
                    maxLength={80}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelectedStoreId(null);
                    }}
                    placeholder="지역·판매점·주소 검색"
                  />
                  {query && (
                    <button
                      type="button"
                      className="search-clear"
                      aria-label="검색어 지우기"
                      onClick={() => {
                        setQuery('');
                        setSelectedStoreId(null);
                      }}
                    >
                      <X />
                    </button>
                  )}
                </label>
                <button
                  className="search-submit"
                  type="submit"
                  aria-label="검색 결과로 지도 이동"
                >
                  <Search />
                </button>
                <button
                  className="mobile-filter-toggle"
                  type="button"
                  aria-expanded={filtersOpen}
                  aria-controls="advanced-filters"
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <SlidersHorizontal />
                  <span>필터</span>
                  {(rankFilter !== 'all' || selectedRound !== 'all') && <i />}
                </button>
              </form>
              <div className="region-controls">
                <NativeSelect
                  className="region-select"
                  aria-label="시·도 선택"
                  value={region}
                  disabled={!isFullData}
                  onChange={(event) => {
                    setRegion(event.target.value);
                    setDistrict('all');
                    setSelectedStoreId(null);
                  }}
                >
                  <NativeSelectOption value="all">
                    전국 · 시/도
                  </NativeSelectOption>
                  {Object.entries(REGION_NAMES).map(([code, name]) => (
                    <NativeSelectOption key={code} value={code}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <NativeSelect
                  className="region-select"
                  aria-label="시·군·구 선택"
                  value={district}
                  disabled={region === 'all' || !districts.length}
                  onChange={(event) => {
                    setDistrict(event.target.value);
                    setSelectedStoreId(null);
                  }}
                >
                  <NativeSelectOption value="all">
                    {region === '세종' ? '세종 전체' : '전체 시/군/구'}
                  </NativeSelectOption>
                  {districts.map((name) => (
                    <NativeSelectOption key={name} value={name}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <button
                  className="reset-filters"
                  type="button"
                  aria-label="전체 필터 초기화"
                  title="전체 필터 초기화"
                  onClick={resetFilters}
                >
                  <RotateCcw />
                </button>
              </div>
              {isMobile && (
                <div className="location-filter">
                  <div className="location-filter-header">
                    <span className="location-filter-label">
                      <LocateFixed aria-hidden="true" />
                      <strong>내 위치 기준</strong>
                    </span>
                    <div className="location-filter-actions">
                      {hasUserLocation && useNearbyFilter && (
                        <button
                          type="button"
                          className="location-clear"
                          onClick={() => {
                            setIsNearbySearchEnabled(false);
                            setLocationError('');
                          }}
                        >
                          <LocateOff aria-hidden="true" />
                          해제
                        </button>
                      )}
                      <Button
                        size="sm"
                        onClick={requestMyLocation}
                        disabled={isLocating}
                      >
                        {isLocating
                          ? '위치 확인 중...'
                          : hasUserLocation
                            ? '위치 새로고침'
                            : '내 위치 찾기'}
                      </Button>
                    </div>
                  </div>
                  {locationError && <p className="location-error">{locationError}</p>}
                  <label className="location-slider-label" htmlFor="location-radius">
                    반경 {nearbyRadiusClamped}m
                    {useNearbyFilter ? ' (현재 적용됨)' : ''}
                  </label>
                  <input
                    id="location-radius"
                    type="range"
                    min={100}
                    max={1000}
                    step={100}
                    value={nearbyRadiusClamped}
                    onChange={(event) => {
                      setNearbyRadiusMeters(Number(event.target.value));
                      if (!useNearbyFilter && hasUserLocation) {
                        setIsNearbySearchEnabled(true);
                      }
                    }}
                    className="location-slider"
                    disabled={!hasUserLocation || isLocating}
                    aria-label="반경 설정"
                  />
                  <small className="location-slider-hint">
                    {useNearbyFilter
                      ? `현재 반경 내 ${visibleStores.length.toLocaleString('ko-KR')}곳`
                      : '위치를 먼저 받아오면 반경 검색이 활성화됩니다'}
                  </small>
                </div>
              )}
              <div className="advanced-filters" id="advanced-filters">
                <div className="filter-label-row">
                  <label htmlFor="round-select">회차</label>
                  <span>
                    {isFullData
                      ? `${data.draws.length.toLocaleString('ko-KR')}개 회차`
                      : '데이터 확인 중'}
                  </span>
                </div>
                <div className="round-control">
                  <Button
                    variant="outline"
                    size="icon-lg"
                    aria-label="이전 회차"
                    onClick={() => nudgeRound(-1)}
                    disabled={
                      !isFullData ||
                      (selectedRound !== 'all' &&
                        Number(selectedRound) <= data.coverageStart)
                    }
                  >
                    <ChevronLeft />
                  </Button>
                  <NativeSelect
                    id="round-select"
                    className="round-select"
                    disabled={!isFullData}
                    value={selectedRound}
                    onChange={(event) => {
                      setSelectedRound(event.target.value);
                      setSelectedStoreId(null);
                    }}
                  >
                    <NativeSelectOption value="all">
                      {isFullData
                        ? `전체 회차 (${data.coverageStart}–${data.latestDraw}회)`
                        : '전체 회차'}
                    </NativeSelectOption>
                    {sortedDraws.map((draw) => (
                      <NativeSelectOption
                        key={draw.draw}
                        value={String(draw.draw)}
                      >
                        {draw.draw}회 · {draw.date.slice(0, 4)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Button
                    variant="outline"
                    size="icon-lg"
                    aria-label="다음 회차"
                    onClick={() => nudgeRound(1)}
                    disabled={
                      !isFullData ||
                      selectedRound === 'all' ||
                      Number(selectedRound) >= data.latestDraw
                    }
                  >
                    <ChevronRight />
                  </Button>
                </div>

                {isFullData && (
                  <p className="coverage-note">
                    {selectedRound === 'all'
                      ? `${data.coverageStart}–${data.latestDraw}회 누적 판매점을 표시 중입니다.`
                      : `${selectedRound}회 판매점을 표시 중입니다.`}
                  </p>
                )}

                <div className="filter-label-row">
                  <span id="rank-label">당첨 등수</span>
                </div>
                <Tabs
                  value={rankFilter}
                  onValueChange={(value) => {
                    setRankFilter(value as RankFilter);
                    setSelectedStoreId(null);
                  }}
                  aria-labelledby="rank-label"
                >
                  <TabsList className="rank-tabs">
                    <TabsTrigger value="all">전체</TabsTrigger>
                    <TabsTrigger value="1">
                      <i className="rank-dot rank-dot-first" />
                      1등
                    </TabsTrigger>
                    <TabsTrigger value="2">
                      <i className="rank-dot rank-dot-second" />
                      2등
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </section>
          </div>
          <div
            id="list-panel"
            className={`bottom-panel ${resultsOpen ? 'is-expanded' : ''}`}
          >
            <button
              className="mobile-results-toggle"
              aria-expanded={resultsOpen}
              aria-controls="results-content"
              onClick={() => setResultsOpen((open) => !open)}
            >
              <span className="sheet-handle" aria-hidden="true" />
              <span>
                <Layers3 aria-hidden="true" />
                판매점{' '}
                <strong>
                  {visibleStores.length.toLocaleString('ko-KR')}곳
                </strong>
                <small> · {totalWins.toLocaleString('ko-KR')}건 당첨</small>
              </span>
              <span>
                {resultsOpen ? '접기' : '목록·회차'}
                {resultsOpen ? <ChevronDown /> : <ChevronUp />}
              </span>
            </button>
            <div id="results-content" className="results-content">
              {activeDraw && (
                <section
                  className="draw-card"
                  aria-label={`${activeDraw.draw}회 당첨 정보`}
                >
                  <div className="draw-card-heading">
                    <div>
                      <span>
                        {selectedRound === 'all'
                          ? '가장 최근 추첨'
                          : '선택한 추첨'}
                      </span>
                      <strong>{activeDraw.draw}회</strong>
                    </div>
                    <time dateTime={activeDraw.date}>
                      {activeDraw.date.replaceAll('-', '. ')}
                    </time>
                  </div>
                  <div className="number-row number-row-large">
                    {activeDraw.numbers.map((number) => (
                      <span
                        className={`lotto-ball ball-${ballTone(number)}`}
                        key={number}
                      >
                        {number}
                      </span>
                    ))}
                    <span className="number-plus">+</span>
                    <span
                      className={`lotto-ball ball-${ballTone(activeDraw.bonus)}`}
                    >
                      {activeDraw.bonus}
                    </span>
                  </div>
                  <div className="prize-strip">
                    <span>
                      <i className="rank-dot rank-dot-first" />
                      1등 <strong>{compactMoney(activeDraw.firstPrize)}</strong>
                    </span>
                    <span>
                      <i className="rank-dot rank-dot-second" />
                      2등{' '}
                      <strong>{compactMoney(activeDraw.secondPrize)}</strong>
                    </span>
                  </div>
                </section>
              )}

              <section className="results-section">
                <div className="results-heading">
                  <div>
                    <Layers3 aria-hidden="true" />
                    <span>지도 표시</span>
                  </div>
                  <output aria-live="polite" aria-atomic="true">
                    {visibleStores.length.toLocaleString('ko-KR')}곳{' '}
                    <small>· {totalWins.toLocaleString('ko-KR')}건</small>
                  </output>
                </div>
                <div className="store-list">
                  {listedStores.map((store) => (
                    <button
                      className={`store-item ${effectiveSelectedStoreId === store.id ? 'is-selected' : ''}`}
                      aria-pressed={effectiveSelectedStoreId === store.id}
                      key={store.id}
                      onClick={() => selectStore(store.id)}
                    >
                      <span className="store-copy">
                        <strong>{store.name}</strong>
                        <small>
                          {store.address}
                          {store.distanceFromUser !== null
                            ? ` · ${formatDistance(store.distanceFromUser)}`
                            : ''}
                        </small>
                      </span>
                      <span className="store-count">
                        {store.visibleWins.reduce(
                          (sum, win) => sum + win.tickets,
                          0,
                        )}
                        건
                      </span>
                    </button>
                  ))}
                {visibleStores.length === 0 && (
                  <div className="empty-result">
                    {isFullData
                        ? useNearbyFilter
                          ? '반경 내 판매점이 없습니다. 반경을 늘리거나 위치를 다시 잡아주세요.'
                          : '조건에 맞는 판매점이 없습니다. 지역이나 검색 조건을 변경해 주세요.'
                        : dataStatus === 'loading'
                          ? '판매점 기록을 불러오는 중입니다.'
                          : '데이터를 다시 불러와 주세요.'}
                  </div>
                )}
                  {visibleStores.length > 80 && (
                    <p className="list-limit">
                      지도에는 전체를 표시하며 목록은 상위 80곳만 보여줍니다.
                    </p>
                  )}
                </div>
              </section>

              <footer className="panel-footer">
                <Database aria-hidden="true" />
                <p>
                  <strong>{data.source}</strong>
                  <span>
                    판매점 기록은 공식 조회가 제공되는 {STORE_COVERAGE_START}
                    회부터입니다. 인터넷 판매점과 좌표가 없는 기록은 지도에서
                    제외됩니다. 위치는 가장 최근 공개 주소 기준입니다.
                  </span>
                </p>
              </footer>
            </div>
          </div>
        </aside>

        <section className="map-stage" aria-label="로또 당첨판매점 지도">
          <div className="map-status-card">
            <span>
              <Sparkles aria-hidden="true" />
              {isFullData
                ? selectedRound === 'all'
                  ? `전체 ${data.draws.length}개 회차 누적`
                  : `${selectedRound}회 당첨 기록`
                : dataStatus === 'error'
                  ? '전체 데이터 연결 실패'
                  : '전체 회차 데이터 확인 중'}
            </span>
            <strong>
              {isFullData ? visibleStores.length.toLocaleString('ko-KR') : '—'}
            </strong>
            <small>
                {useNearbyFilter
                      ? `반경 ${nearbyRadiusClamped}m 내`
                : '개 판매점'}
            </small>
          </div>
          <div className="map-legend" aria-label="마커 범례">
            <span>
              <i className="legend-pin legend-first" />
              1등
            </span>
            <span>
              <i className="legend-pin legend-second" />
              2등
            </span>
            <span>
              <i className="legend-pin legend-both" />
              중복
            </span>
          </div>
          {MapView ? (
            <MapView
              focus={focus}
              stores={visibleStores}
              draws={draws}
              selectedStoreId={effectiveSelectedStoreId}
              onSelectStore={selectStore}
            />
          ) : mapError ? (
            <div className="map-loading map-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <span>지도를 불러오지 못했습니다</span>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                다시 시도
              </Button>
            </div>
          ) : (
            <div className="map-loading">
              <Trophy aria-hidden="true" />
              <span>지도를 불러오는 중입니다</span>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
