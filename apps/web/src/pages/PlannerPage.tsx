import type { LatLng } from '@transit/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { InstallBanner, OfflineBanner } from '../components/Banners';
import { BottomSheet, type Snap } from '../components/BottomSheet';
import { NearbyHeader, NearbyList } from '../components/NearbyLines';
import { SearchPanel } from '../components/SearchPanel';
import { TripResults } from '../components/TripResults';
import { config } from '../config';
import { useInstallPrompt, useMediaQuery, useOnlineStatus } from '../hooks/useBrowser';
import { GEO_ERROR_TEXT, useGeolocation } from '../hooks/useGeolocation';
import { NEARBY_RADII, useNearbyLines, type NearbyRadius } from '../hooks/useNearbyLines';
import { usePlan } from '../hooks/usePlan';
import { parsePhoton, photonReverseUrl } from '../lib/photon';
import { loadRecentTrips, type RecentTrip } from '../lib/recentTrips';
import { readTripFromSearch, tripSearch } from '../lib/url';
import { MapView } from '../map/MapView';
import type { Place } from '../types';

type Tab = 'plan' | 'nearby';
const SIDE_PANEL_PX = 432;

const samePoint = (a: Place, b: Place) =>
  Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;

export function PlannerPage() {
  const initial = useMemo(() => readTripFromSearch(window.location.search), []);
  const [from, setFrom] = useState<Place | null>(initial.from);
  const [to, setTo] = useState<Place | null>(initial.to);
  const [tab, setTab] = useState<Tab>('plan');
  const [snap, setSnap] = useState<Snap>(initial.from && initial.to ? 'half' : 'peek');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [radius, setRadius] = useState<NearbyRadius>(300);
  const [recentTrips, setRecentTrips] = useState<RecentTrip[]>(() => loadRecentTrips());
  const [hasPlanned, setHasPlanned] = useState(false);

  const geo = useGeolocation();
  const online = useOnlineStatus();
  const install = useInstallPrompt();
  const isWide = useMediaQuery('(min-width: 768px)');

  // --- Trip planning ---------------------------------------------------------
  const sameOriginAndDestination = !!from && !!to && samePoint(from, to);
  const query = useMemo(
    () => (from && to && !sameOriginAndDestination ? { from, to } : null),
    [from, to, sameOriginAndDestination],
  );
  const { state: plan, retry } = usePlan(query, (trips) => {
    setRecentTrips(trips);
    setHasPlanned(true);
  });
  const itineraries = plan.status === 'ok' ? plan.data.itineraries : null;
  // The user's pick if it is still in the results, otherwise the best option.
  const selected = itineraries?.find((i) => i.id === selectedId) ?? itineraries?.[0] ?? null;

  // Raise the sheet once per new trip so results are visible (adjust-state-during-render).
  const tripId = query
    ? `${query.from.lat},${query.from.lng}>${query.to.lat},${query.to.lng}`
    : null;
  const [raisedFor, setRaisedFor] = useState<string | null>(null);
  if (tripId && tripId !== raisedFor) {
    setRaisedFor(tripId);
    if (snap === 'peek') setSnap('half');
  }

  // Keep the trip in the URL so it can be shared or turned into a stand QR code.
  useEffect(() => {
    const search = tripSearch(from, to, window.location.search);
    if (search !== window.location.search) {
      history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
    }
  }, [from, to]);

  const startFromMyLocation = async () => {
    const pos = await geo.locate();
    if (pos) setFrom({ name: 'Current location', ...pos, source: 'gps' });
  };

  /** Map long-press / right-click: set the point now, fill in its name when Photon answers. */
  const pickPoint = (point: LatLng, as: 'origin' | 'destination') => {
    const set = as === 'origin' ? setFrom : setTo;
    const pinned: Place = { name: 'Pinned location', ...point, source: 'search' };
    set(pinned);
    setTab('plan');
    fetch(photonReverseUrl(config.geocoderUrl, point))
      .then((r) => (r.ok ? r.json() : null))
      .then((json: unknown) => {
        const name = parsePhoton(json)[0]?.name;
        if (name) set((cur) => (cur === pinned ? { ...pinned, name } : cur));
      })
      .catch(() => {});
  };

  const openRecent = (trip: RecentTrip) => {
    setFrom(trip.from);
    setTo(trip.to);
    setSnap('half');
  };

  // --- Nearby lines ------------------------------------------------------------
  const nearbyCenter = geo.position
    ? { ...geo.position, label: 'you' }
    : from
      ? { lat: from.lat, lng: from.lng, label: from.name }
      : {
          lat: config.demoLocation.lat,
          lng: config.demoLocation.lng,
          label: config.demoLocation.name,
        };
  const nearby = useNearbyLines(nearbyCenter, radius, tab === 'nearby');
  const nextRadius = NEARBY_RADII.find((r) => r > radius) ?? null;

  // Offer install only after the app has proved useful (a successful plan).
  const showInstall = hasPlanned && (install.canInstall || install.showIosHint);

  // --- Layout --------------------------------------------------------------------
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const insets = isWide
    ? { top: 16, right: 16, bottom: 16, left: SIDE_PANEL_PX }
    : {
        top: 16,
        right: 0,
        bottom: Math.round(vh * (snap === 'peek' ? 0.3 : snap === 'half' ? 0.55 : 0.92)),
        left: 0,
      };

  const header = (
    <div className="space-y-3">
      <div role="tablist" aria-label="Mode" className="flex gap-1">
        {(
          [
            ['plan', 'Plan a trip'],
            ['nearby', 'Nearby lines'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="sheet-panel"
            onClick={() => setTab(id)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${tab === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'plan' ? (
        <SearchPanel
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          onSwap={() => {
            setFrom(to);
            setTo(from);
          }}
          onUseMyLocation={() => void startFromMyLocation()}
          locating={geo.status === 'locating'}
          locationError={geo.error ? GEO_ERROR_TEXT[geo.error] : null}
          onInputFocus={() => !isWide && setSnap('full')}
        />
      ) : (
        <NearbyHeader
          centerLabel={nearbyCenter.label}
          radius={radius}
          onRadiusChange={setRadius}
          onUseMyLocation={() => void geo.locate()}
          locating={geo.status === 'locating'}
          usingGps={!!geo.position}
        />
      )}
    </div>
  );

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <MapView
        origin={from}
        destination={to}
        itinerary={tab === 'plan' ? selected : null}
        userLocation={geo.position}
        nearby={tab === 'nearby' ? { center: nearbyCenter, radiusMeters: radius } : null}
        insets={insets}
        onPick={pickPoint}
      />

      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-30 space-y-2 px-3 pt-[max(env(safe-area-inset-top),12px)]"
        style={isWide ? { left: SIDE_PANEL_PX } : undefined}
      >
        {!isWide && (
          <p className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold text-slate-900 shadow-sm backdrop-blur">
            <img src="/favicon.svg" alt="" width={18} height={18} />
            Transit <span className="font-normal text-slate-500">· Delhi pilot</span>
          </p>
        )}
      </div>

      <BottomSheet snap={snap} onSnapChange={setSnap} header={header} label="Trip planner">
        {/* Notices live in the sheet so they never cover the search fields. */}
        {(!online || showInstall) && (
          <div className="space-y-2 px-4 pt-4">
            {!online && <OfflineBanner />}
            {showInstall && (
              <InstallBanner
                ios={!install.canInstall}
                onInstall={() => void install.install()}
                onDismiss={install.dismiss}
              />
            )}
          </div>
        )}
        <div id="sheet-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === 'plan' ? (
            <TripResults
              plan={plan}
              online={online}
              onRetry={retry}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              recentTrips={recentTrips}
              onOpenRecent={openRecent}
              sameOriginAndDestination={sameOriginAndDestination}
            />
          ) : (
            <NearbyList
              state={nearby.state}
              radius={radius}
              onRetry={nearby.retry}
              onWidenRadius={nextRadius ? () => setRadius(nextRadius) : null}
            />
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
