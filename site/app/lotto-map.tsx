'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import type { LottoDraw, VisibleStore } from './lotto-types';

interface LottoMapProps {
  stores: VisibleStore[];
  draws: Record<number, LottoDraw>;
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

function StorePopup({ store, draws }: { store: VisibleStore; draws: Record<number, LottoDraw> }) {
  const [historyLimit, setHistoryLimit] = useState(12);
  const history = [...store.visibleWins].sort((a, b) => b.draw - a.draw);
  const drawCount = new Set(history.map((win) => win.draw)).size;
  const ticketCount = history.reduce((sum, win) => sum + win.tickets, 0);

  return (
    <article className="popup-card">
      <div className="popup-eyebrow">
        <span>{store.region}</span>
        <span>{drawCount}개 회차 · {ticketCount}건 당첨</span>
      </div>
      <h2>{store.name}</h2>
      <p className="popup-address">{store.address}</p>
      <div className="popup-history">
        {history.slice(0, historyLimit).map((win, index) => {
          const draw = draws[win.draw];
          const prize = win.rank === 1 ? draw?.firstPrize : draw?.secondPrize;
          return (
            <section className="popup-win" key={`${win.draw}-${win.rank}-${index}`}>
              <div className="popup-win-heading">
                <strong>{win.draw}회 · {win.rank}등</strong>
                <span>{win.method || '구분 없음'}{win.tickets > 1 ? ` · ${win.tickets}게임` : ''}</span>
              </div>
              {draw ? (
                <>
                  <div className="number-row" aria-label={`${win.draw}회 당첨번호`}>
                    {draw.numbers.map((number) => (
                      <span className={`lotto-ball ball-${ballTone(number)}`} key={number}>{number}</span>
                    ))}
                    <span className="number-plus">+</span>
                    <span className={`lotto-ball ball-${ballTone(draw.bonus)}`}>{draw.bonus}</span>
                  </div>
                  <p className="popup-prize">1게임당 <strong>{prize?.toLocaleString('ko-KR')}원</strong></p>
                </>
              ) : (
                <p className="popup-prize">당첨 상세 정보 확인 중</p>
              )}
            </section>
          );
        })}
      </div>
      {history.length > historyLimit && (
        <button className="popup-more" onClick={(event) => {
          event.stopPropagation();
          setHistoryLimit((limit) => limit + 12);
        }}>
          이전 당첨 기록 더 보기 ({historyLimit}/{history.length})
        </button>
      )}
    </article>
  );
}

function FocusSelected({
  storeId,
  lat,
  lng,
}: {
  storeId?: string;
  lat?: number;
  lng?: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!storeId || lat === undefined || lng === undefined) return;
    const position: L.LatLngExpression = [lat, lng];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      map.setView(position, Math.max(map.getZoom(), 13), { animate: false });
      return;
    }
    map.flyTo(position, Math.max(map.getZoom(), 13), { duration: 0.75 });
  }, [lat, lng, map, storeId]);
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
  onSelectStore: (id: string | null) => void;
}

const StoreMarker = memo(function StoreMarker({
  id,
  name,
  lat,
  lng,
  ticketCount,
  icon,
  onSelectStore,
}: StoreMarkerProps) {
  const handleClick = useCallback(() => onSelectStore(id), [id, onSelectStore]);
  return (
    <Marker
      position={[lat, lng]}
      icon={icon}
      title={`${name} · ${ticketCount}건`}
      eventHandlers={{ click: handleClick }}
    />
  );
});

export function LottoMap({ stores, draws, selectedStoreId, onSelectStore }: LottoMapProps) {
  const icons = useMemo(() => ({
    first: L.divIcon({ className: 'lotto-marker-wrap', html: '<span class="lotto-marker marker-first"><i>1</i></span>', iconSize: [38, 46], iconAnchor: [19, 44], popupAnchor: [0, -40] }),
    second: L.divIcon({ className: 'lotto-marker-wrap', html: '<span class="lotto-marker marker-second"><i>2</i></span>', iconSize: [34, 42], iconAnchor: [17, 40], popupAnchor: [0, -36] }),
    both: L.divIcon({ className: 'lotto-marker-wrap', html: '<span class="lotto-marker marker-both"><i>1+2</i></span>', iconSize: [40, 48], iconAnchor: [20, 46], popupAnchor: [0, -42] }),
  }), []);

  const selectedStore = stores.find((store) => store.id === selectedStoreId);
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <MapContainer
      center={[36.32, 127.83]}
      zoom={7}
      minZoom={6}
      maxZoom={18}
      scrollWheelZoom
      className="lotto-map"
      zoomControl={false}
      zoomAnimation={!prefersReducedMotion}
      fadeAnimation={!prefersReducedMotion}
      markerZoomAnimation={!prefersReducedMotion}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ZoomControl position="topright" />
      <MarkerClusterGroup
        chunkedLoading
        removeOutsideVisibleBounds
        maxClusterRadius={52}
        iconCreateFunction={(cluster: { getChildCount: () => number }) => L.divIcon({
          className: 'lotto-cluster-wrap',
          html: `<span class="lotto-cluster"><strong>${cluster.getChildCount().toLocaleString('ko-KR')}</strong></span>`,
          iconSize: L.point(48, 48),
        })}
      >
        {stores.map((store) => {
          const ticketCount = store.visibleWins.reduce((sum, win) => sum + win.tickets, 0);
          return (
          <StoreMarker
            key={store.id}
            id={store.id}
            name={store.name}
            lat={store.lat}
            lng={store.lng}
            ticketCount={ticketCount}
            icon={icons[markerKind(store)]}
            onSelectStore={onSelectStore}
          />
          );
        })}
      </MarkerClusterGroup>
      <FocusSelected storeId={selectedStore?.id} lat={selectedStore?.lat} lng={selectedStore?.lng} />
      {selectedStore ? (
        <Popup
          key={selectedStore.id}
          position={[selectedStore.lat, selectedStore.lng]}
          minWidth={296}
          maxWidth={340}
        >
          <StorePopup store={selectedStore} draws={draws} />
        </Popup>
      ) : null}
    </MapContainer>
  );
}
