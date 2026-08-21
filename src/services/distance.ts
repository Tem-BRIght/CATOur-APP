// src/services/distance.ts
// ─────────────────────────────────────────────────────────────────────────────
// Haversine great-circle distance utilities.
// Imported by home.tsx as:  import { formatDistance } from '../../services/distance'
// ─────────────────────────────────────────────────────────────────────────────

/**
 * haversineKm
 * Returns the straight-line distance between two GPS coordinates in kilometres.
 */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R    = 6371; // Earth's mean radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * formatDistance
 * Returns a human-readable distance string, e.g. "320 m away" or "3.2 km away".
 * Returns "—" if coordinates are missing.
 */
export function formatDistance(
  userLat:  number,
  userLng:  number,
  destLat:  number | undefined | null,
  destLng:  number | undefined | null,
): string {
  if (destLat == null || destLng == null) return '—';
  const km = haversineKm(userLat, userLng, destLat, destLng);
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km.toFixed(1)} km away`;
}