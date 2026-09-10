'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  TileLayer,
  ZoomControl,
  useMap,
} from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { ChevronLeft, ChevronRight, Map, Satellite, X } from 'lucide-react';
import type { LottoDraw, MapFocus, VisibleStore } from './lotto-types';

interface LottoMapProps {
  stores: VisibleStore[];
  draws: Record<number, LottoDraw>;
  focus: MapFocus;
  selectedStoreId: string | null;
  onSelectStore: (id: string | null) => void;
}

function ballTone(number: number) {
  if (number <= 10) return 'yellow';
  if (number <= 20) return 'blue';
  if (number <= 30) return 'red';
  if (number <= 40) return 'gray';
  return 'green';
}

function StoreDetails({
  store,
  draws,
  onClose,
}: {
  store: VisibleStore;
  draws: Record<number, LottoDraw>;
  onClose: () => void;
}) {
  const [historyLimit, setHistoryLimit] = useState(12);
  const rail = useRef<HTMLElement>(null);
  const history = useMemo(
    () => [...store.visibleWins].sort((a, b) => b.draw - a.draw),
    [store.visibleWins],
  );
  const drawCount = new Set(history.map((win) => win.draw)).size;
  const ticketCount = history.reduce((sum, win) => sum + win.tickets, 0);
  const moveHistory = (direction: number) => {
    const element = rail.current;
    if (!element) return;
    element.scrollBy({
      left:
        direction *
        ((element.querySelector('section')?.clientWidth || 260) + 12),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <article
      id="store-detail"
      className="store-detail"
      aria-label={`${store.name} 당첨 상세 정보`}
    >
      <button
        className="detail-close"
        aria-label="판매점 상세 닫기"
        onClick={onClose}
      >
        <X />
      </button>
      <header className="detail-summary">
        <div className="detail-eyebrow">
          <span>{store.region}</span>
          <span>선택한 판매점</span>
        </div>
        <h2>{store.name}</h2>
        <p className="detail-address">{store.address}</p>
        <div className="detail-totals">
          <strong>
            {ticketCount.toLocaleString('ko-KR')}
            <small>건 당첨</small>
          </strong>
          <span>{drawCount}개 회차</span>
        </div>
      </header>
      <div className="detail-records">
        <div className="detail-records-heading">
          <span>
            회차별 당첨 기록 <small>옆으로 넘겨보세요</small>
          </span>
          <div>
            <button aria-label="이전 당첨 카드" onClick={() => moveHistory(-1)}>
              <ChevronLeft />
            </button>
            <button aria-label="다음 당첨 카드" onClick={() => moveHistory(1)}>
              <ChevronRight />
            </button>
          </div>
        </div>
        <section
          ref={rail}
          className="detail-history"
          aria-label="당첨 기록 가로 목록"
        >
          {history.slice(0, historyLimit).map((win, index) => {
            const draw = draws[win.draw];
            const prize = win.rank === 1 ? draw?.firstPrize : draw?.secondPrize;
            return (
              <section
                className="detail-win"
                key={`${win.draw}-${win.rank}-${index}`}
              >
                <div className="detail-win-heading">
                  <strong>
                    {win.draw}회{' '}
                    <b className={`detail-rank detail-rank-${win.rank}`}>
                      {win.rank}등
                    </b>
                  </strong>
                  <span>
                    {win.method || '구분 없음'}
                    {win.tickets > 1 ? ` · ${win.tickets}게임` : ''}
                  </span>
                </div>
                {draw ? (
                  <>
                    <div
                      className="number-row"
                      aria-label={`${win.draw}회 당첨번호`}
                    >
                      {draw.numbers.map((number) => (
                        <span
                          className={`lotto-ball ball-${ballTone(number)}`}
                          key={number}
                        >
                          {number}
                        </span>
                      ))}
                      <span className="number-plus">+</span>
                      <span
                        className={`lotto-ball ball-${ballTone(draw.bonus)}`}
                      >
                        {draw.bonus}
                      </span>
                    </div>
                    <p className="detail-prize">
                      1게임당{' '}
                      <strong>{prize?.toLocaleString('ko-KR')}원</strong>
                    </p>
                  </>
                ) : (
                  <p className="detail-prize">당첨 상세 정보 확인 중</p>
                )}
              </section>
            );
          })}
          {history.length > historyLimit && (
            <button
              className="detail-more"
              onClick={() => setHistoryLimit((limit) => limit + 12)}
            >
              이전 당첨 기록 더 보기
              <span>
                {historyLimit} / {history.length}
              </span>
              <ChevronRight />
            </button>
          )}
        </section>
      </div>
    </article>
  );
}

function MapViewport({
  focus,
  selectedStore,
}: {
  focus: MapFocus;
  selectedStore?: VisibleStore;
}) {
  const map = useMap();
  const lat = selectedStore?.lat;
  const lng = selectedStore?.lng;
  const id = selectedStore?.id;
  const previousFocus = useRef<MapFocus | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      map.invalidateSize({ pan: false }),
    );
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    if (!id && previousFocus.current === focus) return;
    const points: [number, number][] =
      lat !== undefined && lng !== undefined ? [[lat, lng]] : focus.points;
    if (!points.length) return;
    const frame = requestAnimationFrame(() => {
      const workspace = map.getContainer().closest('.workspace');
      const mobile = window.matchMedia('(max-width: 900px)').matches;
      const top = mobile
        ? workspace?.querySelector('.top-panel')?.getBoundingClientRect()
            .height || 0
        : 0;
      const bottom =
        workspace
          ?.querySelector(
            id ? '.store-detail' : mobile ? '.bottom-panel' : '.map-legend',
          )
          ?.getBoundingClientRect().height || 0;
      const size = map.getSize();
      map.invalidateSize({ pan: false });
      previousFocus.current = focus;
      map.fitBounds(L.latLngBounds(points), {
        paddingTopLeft: [
          mobile ? 25 : 65,
          Math.min(mobile ? top + 75 : 100, size.y * 0.35),
        ],
        paddingBottomRight: [
          mobile ? 25 : 65,
          Math.min(bottom + 65, size.y * 0.4),
        ],
        maxZoom: id ? Math.max(map.getZoom(), 14) : 12,
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, id, lat, lng, map]);
  return null;
}

function markerKind(store: VisibleStore) {
  const ranks = new Set(store.visibleWins.map((win) => win.rank));
  if (ranks.size > 1) return 'both';
  return ranks.has(1) ? 'first' : 'second';
}

interface StoreMarkerProps {
  id: string;
  name: string;
  lat: number;
  lng: number;
  ticketCount: number;
  icon: L.DivIcon;
  selected: boolean;
  onSelectStore: (id: string | null) => void;
}

const StoreMarker = memo(function StoreMarker({
  id,
  name,
  lat,
  lng,
  ticketCount,
  icon,
  selected,
  onSelectStore,
}: StoreMarkerProps) {
  const handleClick = useCallback(() => onSelectStore(id), [id, onSelectStore]);
  return (
    <Marker
      position={[lat, lng]}
      icon={icon}
      title={`${name} · ${ticketCount}건`}
      alt={`${name} 판매점`}
      zIndexOffset={selected ? 2000 : 0}
      eventHandlers={{ click: handleClick }}
    />
  );
});

export function LottoMap({
  stores,
  draws,
  focus,
  selectedStoreId,
  onSelectStore,
}: LottoMapProps) {
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');
  const [tileError, setTileError] = useState(false);
  const [tileRevision, setTileRevision] = useState(0);
  const icons = useMemo(() => {
    const make = (kind: string, selected: boolean) =>
      L.divIcon({
        className: `lotto-marker-wrap ${selected ? 'marker-selected' : ''}`,
        html: `<span class="lotto-marker marker-${kind}"><i>${kind === 'both' ? '1+2' : kind === 'first' ? '1' : '2'}</i></span>`,
        iconSize: [40, 48],
        iconAnchor: [20, 46],
      });
    return {
      first: make('first', false),
      second: make('second', false),
      both: make('both', false),
      firstSelected: make('first', true),
      secondSelected: make('second', true),
      bothSelected: make('both', true),
    };
  }, []);
  const selectedStore = stores.find((store) => store.id === selectedStoreId);
  const closeDetails = useCallback(() => onSelectStore(null), [onSelectStore]);
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;

  return (
    <>
      <fieldset className="map-style-control" aria-label="지도 종류">
        <button
          aria-label="일반 지도"
          aria-pressed={mapStyle === 'street'}
          onClick={() => {
            setMapStyle('street');
            setTileError(false);
          }}
        >
          <Map />
        </button>
        <button
          aria-label="항공사진 지도"
          aria-pressed={mapStyle === 'satellite'}
          onClick={() => {
            setMapStyle('satellite');
            setTileError(false);
          }}
        >
          <Satellite />
        </button>
      </fieldset>
      {tileError && (
        <output className="tile-error">
          지도 이미지를 불러오지 못했습니다.
          <button
            onClick={() => {
              setTileRevision((value) => value + 1);
              setTileError(false);
            }}
          >
            다시 시도
          </button>
        </output>
      )}
      <MapContainer
        center={[36.32, 127.83]}
        zoom={7}
        minZoom={5}
        maxZoom={18}
        scrollWheelZoom
        className="lotto-map"
        zoomControl={false}
        zoomAnimation={!reducedMotion}
        fadeAnimation={!reducedMotion}
        markerZoomAnimation={!reducedMotion}
      >
        {mapStyle === 'street' ? (
          <TileLayer
            key={`street-${tileRevision}`}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            eventHandlers={{
              loading: () => setTileError(false),
              tileerror: () => setTileError(true),
            }}
          />
        ) : (
          <>
            <TileLayer
              key={`satellite-${tileRevision}`}
              attribution='Imagery &copy; <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9">Esri</a>, Maxar, Earthstar Geographics, GIS User Community'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              eventHandlers={{
                loading: () => setTileError(false),
                tileerror: () => setTileError(true),
              }}
            />
            <TileLayer
              key={`labels-${tileRevision}`}
              attribution="Labels &copy; Esri, HERE, Garmin"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              maxNativeZoom={16}
              zIndex={2}
            />
          </>
        )}
        <ZoomControl position="topright" />
        <MarkerClusterGroup
          chunkedLoading
          removeOutsideVisibleBounds
          maxClusterRadius={52}
          iconCreateFunction={(cluster: { getChildCount: () => number }) =>
            L.divIcon({
              className: 'lotto-cluster-wrap',
              html: `<span class="lotto-cluster"><strong>${cluster.getChildCount().toLocaleString('ko-KR')}</strong></span>`,
              iconSize: L.point(48, 48),
            })
          }
        >
          {stores.map((store) => {
            const selected = store.id === selectedStoreId;
            const kind = markerKind(store);
            return (
              <StoreMarker
                key={store.id}
                id={store.id}
                name={store.name}
                lat={store.lat}
                lng={store.lng}
                ticketCount={store.visibleWins.reduce(
                  (sum, win) => sum + win.tickets,
                  0,
                )}
                icon={icons[selected ? (`${kind}Selected` as const) : kind]}
                selected={selected}
                onSelectStore={onSelectStore}
              />
            );
          })}
        </MarkerClusterGroup>
        <MapViewport focus={focus} selectedStore={selectedStore} />
      </MapContainer>
      {selectedStore && (
        <StoreDetails
          key={selectedStore.id}
          store={selectedStore}
          draws={draws}
          onClose={closeDetails}
        />
      )}
    </>
  );
}
