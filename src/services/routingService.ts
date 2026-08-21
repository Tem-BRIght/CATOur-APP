// src/services/routingService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Turn-by-turn-ish directions for CATOUR, backed by the public OSRM instance
// at routing.openstreetmap.de — free, no API key.
//
// CHANGED: this used to hit router.project-osrm.org (a different public OSRM
// demo). DestinationDetail.tsx independently built its own routing call
// against routing.openstreetmap.de/routed-foot and routed-car — proven
// working in this app already, and it supports driving mode where the old
// endpoint here only ever did walking. Standardizing on the same endpoint
// here means maps.tsx, aiService.ts, and Proximityaicontext.tsx all get the
// same (already-tested) routing backend DestinationDetail.tsx uses, instead
// of three screens quietly depending on two different third-party services.
//
// ⚠️ STILL A CAVEAT: this is a public instance with no uptime SLA. Fine for
// dev/light production. If CATOUR grows real traffic, self-host OSRM or
// switch to a paid provider — only OSRM_BASE and the response-parsing below
// would need to change.
//
// Used by:
//   maps.tsx                        → draws the polyline + shows distance/ETA
//   DestinationDetail.tsx            → its own live-tracking route (not yet
//                                      switched to call this file — see note
//                                      at getWalkingRoute)
//   AIGuide.tsx / Proximityaicontext → answers "how do I get there / how far"
//                                      with real numbers instead of guessing
// ─────────────────────────────────────────────────────────────────────────────

import { haversineKm } from './distance';

export type RouteMode = 'walking' | 'driving';

/** Each mode hits a different OSRM backend so paths are genuinely distinct:
 *    walking → routed-foot : footpaths, alleys, pedestrian shortcuts
 *    driving → routed-car  : roads/streets only, no pedestrian ways
 *  Matches DestinationDetail.tsx's OSRM_BASE exactly. */
const OSRM_BASE: Record<RouteMode, string> = {
  walking: 'https://routing.openstreetmap.de/routed-foot',
  driving: 'https://routing.openstreetmap.de/routed-car',
};

export interface LatLng {
  lat: number;
  lng: number;
}

export interface WalkingRoute {
  /** Ordered path points, ready to hand straight to Leaflet's L.polyline(). */
  path: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  mode: RouteMode;
  /** True if this is a real road/path route from OSRM; false = straight-line fallback. */
  isRealRoute: boolean;
}

function formatDurationLabel(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

export function formatDistanceLabel(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * straightLineFallback
 * Used when OSRM is unreachable/errors, or when the two points are so close
 * a real route call isn't worth the network round-trip. Walking speed
 * assumed at 4.5 km/h (~13.3 min/km); driving at 30 km/h (rough city-street
 * average) for the ETA estimate.
 */
function straightLineFallback(origin: LatLng, dest: LatLng, mode: RouteMode): WalkingRoute {
  const km = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
  const speedKmh = mode === 'walking' ? 4.5 : 30;
  return {
    path: [[origin.lat, origin.lng], [dest.lat, dest.lng]],
    distanceMeters: km * 1000,
    durationSeconds: (km / speedKmh) * 3600,
    mode,
    isRealRoute: false,
  };
}

/**
 * getWalkingRoute
 * Fetches a real route between two points from OSRM. Named "Walking" for
 * backward compat with existing callers (maps.tsx, aiService.ts,
 * Proximityaicontext.tsx all call this with no mode argument and expect
 * walking directions) — pass `mode: 'driving'` explicitly to get driving
 * directions instead. Falls back to a straight line (with a speed-based ETA
 * estimate) if OSRM fails — callers should still render `path` either way,
 * just maybe show a subtler dashed line when `isRealRoute` is false.
 *
 * NOTE: DestinationDetail.tsx has its own inline copy of this exact fetch
 * (against the same OSRM_BASE URLs) with added live-tracking behavior
 * (continuous watchPosition instead of a one-shot fix). It hasn't been
 * switched to call this shared function yet — that'd remove the last
 * duplicate routing implementation in the app, but touches the live-map
 * screen so it's worth doing as its own deliberate change rather than
 * folded into this one.
 */
export async function getWalkingRoute(
  origin: LatLng,
  dest: LatLng,
  mode: RouteMode = 'walking',
): Promise<WalkingRoute> {
  try {
    const baseUrl = OSRM_BASE[mode];
    const profile = mode === 'walking' ? 'foot' : 'driving';
    const url =
      `${baseUrl}/route/v1/${profile}/${origin.lng},${origin.lat};${dest.lng},${dest.lat}` +
      `?overview=full&geometries=geojson&alternatives=false&steps=false`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`OSRM ${response.status}`);

    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('OSRM: no route returned');
    const route = data.routes[0];

    // GeoJSON coordinates are [lng, lat] — Leaflet wants [lat, lng].
    const path: [number, number][] = route.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => [lat, lng],
    );

    return {
      path,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      mode,
      isRealRoute: true,
    };
  } catch (err) {
    console.warn(`[routingService] getWalkingRoute (${mode}) fell back to straight line:`, err);
    return straightLineFallback(origin, dest, mode);
  }
}

/**
 * describeRouteForPrompt
 * One-line, prompt-safe summary of a route — for ALI to read back to a
 * tourist asking "how do I get there" / "gaano kalayo" without inventing
 * numbers.
 */
export function describeRouteForPrompt(route: WalkingRoute, placeName: string): string {
  const dist = formatDistanceLabel(route.distanceMeters);
  const time = formatDurationLabel(route.durationSeconds);
  const verb = route.mode === 'driving' ? 'driving' : 'on foot';
  return route.isRealRoute
    ? `${route.mode === 'driving' ? 'Driving' : 'Walking'} route to ${placeName}: about ${dist}, roughly ${time} ${verb}.`
    : `Straight-line distance to ${placeName}: about ${dist} (~${time} ${verb}, exact path not available right now).`;
}

/**
 * openExternalNavigation
 * Hands off to Google Maps for real turn-by-turn, voice-guided navigation
 * with live traffic — something the in-app OSRM polyline deliberately
 * doesn't try to replace. Opens in a new tab on web; on the compiled
 * Android APK this resolves to the Google Maps app via the same
 * intent-style URL, no extra native code needed.
 *
 * `mode` defaults to 'walking' to match the in-app route, but 'driving'/
 * 'transit' are useful if a guide or tourist wants a jeepney/tricycle-ish
 * transit estimate instead.
 */
export function openExternalNavigation(
  origin: LatLng,
  dest: LatLng,
  mode: 'walking' | 'driving' | 'transit' = 'walking',
): void {
  const url =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${origin.lat},${origin.lng}` +
    `&destination=${dest.lat},${dest.lng}` +
    `&travelmode=${mode}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}