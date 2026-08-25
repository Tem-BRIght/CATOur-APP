// src/services/destinationService.ts
// ─────────────────────────────────────────────────────────────────────────────
// All Firestore reads for the "destinations" collection.
//
// Exports consumed by the app:
//   home.tsx            → subscribeRecommendedDestinations, subscribePopularDestinations
//   DestinationDetail   → fetchDestinationById, subscribeDestinationById
//
// Firestore collection path: /destinations/{docId}
// ─────────────────────────────────────────────────────────────────────────────

import {
  collection, doc, getDoc, getDocs, onSnapshot,
  query, where, orderBy, limit,
  QuerySnapshot, DocumentData, Unsubscribe,
} from 'firebase/firestore';
import { firestore } from '../firebase';
import { Destination } from '../types';

// ── Internal helpers ──────────────────────────────────────────────────────────

const COLLECTION = 'destinations';
const col        = () => collection(firestore, COLLECTION);

/**
 * Map a raw Firestore document → typed Destination.
 * Handles BOTH mobile-app field shapes and admin panel field shapes.
 */
function normalise(id: string, data: DocumentData): Destination {
  const name  = data.name  || data.title || '';
  const title = data.title || data.name  || '';

  const description = data.fullDescription || '';
  const desc        = data.shortDescription || '';

  const image    = data.image    || data.imageUrl || (data.images?.[0] ?? '');
  const imageUrl = data.imageUrl || data.image    || (data.images?.[0] ?? '');

  const address = data.address || (typeof data.location === 'string' ? data.location : '') || '';

  const location =
    data.location && typeof data.location === 'object' && data.location.lat
      ? data.location
      : data.locationCoords?.lat
        ? { lat: data.locationCoords.lat, lng: data.locationCoords.lng }
        : null;

  const hours       = data.hours       || data.openingHours || '';
  const admission   = data.admission   || data.entranceFee  || data.fee || data.price || '';
  const suitableFor =
    data.suitableFor || data.audience || data.visitorTypes ||
    (Array.isArray(data.goodFor) ? data.goodFor.join(', ') : '') || '';
  const parking = data.parking || '';

  const status =
    data.tempStatus === 'Temporarily Closed'
      ? 'Temporarily Closed'
      : data.status || '';

  return {
    ...data,
    id,
    name,
    title,
    description,
    desc,
    image,
    imageUrl,
    address,
    location,
    hours,
    admission,
    suitableFor,
    parking,
    status,
    closeReason: data.closeReason  || '',
    rating:      parseFloat(data.rating) || 0,
    reviews:     data.reviewCount  ?? data.reviews ?? 0,
    category:    data.category     || '',
    ranking:     data.ranking      || data.mostVisitedRank || null,
    infoBlocks:  data.infoBlocks   || [],
    featured:    !!data.featured,
    distance:    data.distance     || '',
    goodFor:     Array.isArray(data.goodFor) ? data.goodFor : [],
  } as Destination;
}

function fromSnapshot(snap: QuerySnapshot<DocumentData>): Destination[] {
  return snap.docs.map(d => normalise(d.id, d.data()));
}

// ── Offline cache (localStorage) ──────────────────────────────────────────
// Keeps the last-known-good destinations list (and individual docs) around
// so Home and DestinationDetail can still render when the device has no
// connectivity. Cache is best-effort: any read/write failure (private
// browsing, storage quota, etc.) just degrades to "no cache" rather than
// throwing, since destinations are non-critical, re-fetchable data.

const CACHE_KEY_ALL          = 'catour:cache:destinations:all';
const CACHE_KEY_BY_ID_PREFIX = 'catour:cache:destinations:byId:';
/** How stale a cache entry is allowed to be before we stop trusting it
 *  as a "fresh enough" fallback — still shown if it's all we have, but
 *  callers can check `isStale` to warn the user. */
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEnvelope<T> {
  data: T;
  cachedAt: number;
}

function writeCache<T>(key: string, data: T): void {
  try {
    const envelope: CacheEnvelope<T> = { data, cachedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch (err) {
    console.warn('[destinationService] cache write failed (non-fatal):', err);
  }
}

function readCache<T>(key: string): { data: T; isStale: boolean } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    if (!envelope || envelope.data === undefined) return null;
    const isStale = Date.now() - envelope.cachedAt > CACHE_MAX_AGE_MS;
    return { data: envelope.data, isStale };
  } catch {
    return null;
  }
}

/** Cache the full destinations list, and mirror each doc into its own
 *  by-id entry so fetchDestinationById() can serve a single-item cache
 *  hit without needing the full list to have loaded first. */
function cacheDestinationsList(destinations: Destination[]): void {
  writeCache(CACHE_KEY_ALL, destinations);
  destinations.forEach(d => {
    writeCache(`${CACHE_KEY_BY_ID_PREFIX}${d.id}`, d);
  });
}

function getCachedDestinationsList(): { data: Destination[]; isStale: boolean } | null {
  return readCache<Destination[]>(CACHE_KEY_ALL);
}

function getCachedDestinationById(id: string): { data: Destination; isStale: boolean } | null {
  return readCache<Destination>(`${CACHE_KEY_BY_ID_PREFIX}${id}`);
}

/**
 * isOffline
 * Small helper so callers/UI can check connectivity without importing
 * the Network API directly. Exported for use in home.tsx / DestinationDetail.
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * clearDestinationsCache
 * Exposed in case Settings ever wants a "Clear offline data" action.
 */
export function clearDestinationsCache(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key === CACHE_KEY_ALL || key.startsWith(CACHE_KEY_BY_ID_PREFIX))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (err) {
    console.warn('[destinationService] clearDestinationsCache failed:', err);
  }
}

// ── One-time reads (kept for DestinationDetail fallback / search) ─────────────

export const fetchDestinationById = async (id: string): Promise<Destination | null> => {
  try {
    const snap = await getDoc(doc(firestore, COLLECTION, id));
    if (!snap.exists()) return null;
    const destination = normalise(snap.id, snap.data());
    writeCache(`${CACHE_KEY_BY_ID_PREFIX}${id}`, destination); // cache on success
    return destination;
  } catch (err) {
    console.error('[destinationService] fetchDestinationById failed:', err);
    // Offline (or any network failure) — fall back to whatever we cached
    // last time this destination was successfully fetched.
    const cached = getCachedDestinationById(id);
    if (cached) {
      console.warn('[destinationService] serving cached destination (offline fallback):', id);
      return cached.data;
    }
    return null;
  }
};

export const fetchDestinationsByIds = async (ids: string[]): Promise<Destination[]> => {
  if (!ids || ids.length === 0) return [];
  const results = await Promise.all(ids.map((id) => fetchDestinationById(id)));
  return results.filter((destination): destination is Destination => destination !== null);
};

export const fetchDestinations = async (): Promise<Destination[]> => {
  try {
    const snap = await getDocs(col());
    const destinations = fromSnapshot(snap);
    cacheDestinationsList(destinations); // cache on success
    return destinations;
  } catch (err) {
    console.error('[destinationService] fetchDestinations failed:', err);
    const cached = getCachedDestinationsList();
    if (cached) {
      console.warn('[destinationService] serving cached destinations (offline fallback), stale:', cached.isStale);
      return cached.data;
    }
    return [];
  }
};

// ── Kept for backward-compat with any remaining one-shot callers ──────────────

export const fetchRecommendedDestinations = async (): Promise<Destination[]> => {
  try {
    const recSnap = await getDocs(
      query(col(), where('recommended', '==', true), orderBy('rating', 'desc'), limit(20))
    );
    if (!recSnap.empty) return fromSnapshot(recSnap).filter(d => (d as any).status !== 'draft');

    const pubSnap = await getDocs(
      query(col(), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(20))
    );
    if (!pubSnap.empty) return fromSnapshot(pubSnap);

    const fallback = await getDocs(query(col(), orderBy('rating', 'desc'), limit(10)));
    return fromSnapshot(fallback).filter(d => (d as any).status !== 'draft');
  } catch (err: any) {
    console.warn('[destinationService] fetchRecommendedDestinations fallback:', err?.message);
    try {
      const snap = await getDocs(query(col(), limit(20)));
      const data = fromSnapshot(snap).filter(d => (d as any).status !== 'draft');
      cacheDestinationsList(data);
      return data;
    } catch (e) {
      console.error('[destinationService] fetchRecommendedDestinations failed:', e);
      // Final offline fallback before giving up entirely
      const cached = getCachedDestinationsList();
      return cached ? cached.data : [];
    }
  }
};

export const fetchPopularDestinations = async (): Promise<Destination[]> => {
  try {
    // Return a broad candidate set so PopularAll can rank by actual visits,
    // then rating, instead of showing only destinations marked as featured.
    const snap = await getDocs(query(col(), limit(50)));
    return fromSnapshot(snap);
  } catch (err: any) {
    console.warn('[destinationService] fetchPopularDestinations fallback:', err?.message);
    try {
      const snap = await getDocs(query(col(), limit(20)));
      const data = fromSnapshot(snap);
      cacheDestinationsList(data);
      return data;
    } catch (e) {
      console.error('[destinationService] fetchPopularDestinations failed:', e);
      const cached = getCachedDestinationsList();
      return cached ? cached.data : [];
    }
  }
};

// ── Real-time listeners ───────────────────────────────────────────────────────

/**
 * subscribeRecommendedDestinations
 * Streams recommended destinations in real-time.
 * Tries recommended==true first, falls back to published, then all.
 * Returns an unsubscribe function — call in useEffect cleanup.
 */
export function subscribeRecommendedDestinations(
  onChange: (destinations: Destination[]) => void,
): Unsubscribe {
  // Try recommended=true first
  let q = query(col(), where('recommended', '==', true), orderBy('rating', 'desc'), limit(20));

  const unsub = onSnapshot(
    q,
    (snap) => {
      if (!snap.empty) {
        const data = fromSnapshot(snap).filter(d => (d as any).status !== 'draft');
        cacheDestinationsList(data); // cache every live update
        onChange(data);
        return;
      }
      // No recommended docs — fall back to published
      const fallbackUnsub = onSnapshot(
        query(col(), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(20)),
        (pubSnap) => {
          if (!pubSnap.empty) {
            const data = fromSnapshot(pubSnap);
            cacheDestinationsList(data);
            onChange(data);
          } else {
            // Last resort: all docs by rating
            onSnapshot(
              query(col(), orderBy('rating', 'desc'), limit(10)),
              (rSnap) => {
                const data = fromSnapshot(rSnap).filter(d => (d as any).status !== 'draft');
                cacheDestinationsList(data);
                onChange(data);
              },
              (err) => console.error('[destinationService] subscribeRecommended rating fallback:', err),
            );
          }
        },
        (err) => console.error('[destinationService] subscribeRecommended published fallback:', err),
      );
      // Note: inner fallback unsubscribes are not exposed — they live as long as
      // the outer listener, which is acceptable for this use-case.
      void fallbackUnsub;
    },
    (err) => {
      console.warn('[destinationService] subscribeRecommended onSnapshot error:', err?.message);
      // NEW — offline: serve cache immediately instead of an empty list,
      // then still attempt the unordered fallback in case connectivity
      // returns mid-session.
      const cached = getCachedDestinationsList();
      if (cached) onChange(cached.data);
      onSnapshot(
        query(col(), limit(20)),
        (snap) => {
          const data = fromSnapshot(snap).filter(d => (d as any).status !== 'draft');
          cacheDestinationsList(data);
          onChange(data);
        },
        (e) => console.error('[destinationService] subscribeRecommended unordered fallback:', e),
      );
    },
  );

  return unsub;
}

/**
 * subscribePopularDestinations
 * Streams destinations that can be ranked as popular in real-time.
 * Home ranks these candidates by visits first, then rating.
 * Returns an unsubscribe function — call in useEffect cleanup.
 */
export function subscribePopularDestinations(
  onChange: (destinations: Destination[]) => void,
): Unsubscribe {
  const unsub = onSnapshot(
    // Load enough candidates for Home to rank the actual top five. Limiting
    // this query to featured destinations hides all non-featured places when
    // only a few destinations have featured=true.
    query(col(), limit(50)),
    (snap) => {
      if (!snap.empty) {
        const data = fromSnapshot(snap);
        cacheDestinationsList(data);
        onChange(data);
        return;
      }
      // Fall back to most-reviewed
      onSnapshot(
        query(col(), orderBy('reviewCount', 'desc'), limit(20)),
        (snap2) => {
          if (!snap2.empty) {
            const data = fromSnapshot(snap2);
            cacheDestinationsList(data);
            onChange(data);
          } else {
            onSnapshot(
              query(col(), orderBy('rating', 'desc'), limit(20)),
              (snap3) => {
                const data = fromSnapshot(snap3);
                cacheDestinationsList(data);
                onChange(data);
              },
              (err) => console.error('[destinationService] subscribePopular rating fallback:', err),
            );
          }
        },
        (err) => console.error('[destinationService] subscribePopular reviewCount fallback:', err),
      );
    },
    (err) => {
      console.warn('[destinationService] subscribePopular onSnapshot error:', err?.message);
      const cached = getCachedDestinationsList();
      if (cached) onChange(cached.data);
      onSnapshot(
        query(col(), limit(20)),
        (snap) => {
          const data = fromSnapshot(snap);
          cacheDestinationsList(data);
          onChange(data);
        },
        (e) => console.error('[destinationService] subscribePopular unordered fallback:', e),
      );
    },
  );

  return unsub;
}

/**
 * subscribeDestinationById
 * Streams a single destination document in real-time.
 * Used by DestinationDetail so edits from the admin panel appear immediately.
 * Returns an unsubscribe function — call in useEffect cleanup.
 */
export function subscribeDestinationById(
  id: string,
  onChange: (destination: Destination | null) => void,
): Unsubscribe {
  return onSnapshot(
    doc(firestore, COLLECTION, id),
    (snap) => {
      if (!snap.exists()) { onChange(null); return; }
      const destination = normalise(snap.id, snap.data());
      writeCache(`${CACHE_KEY_BY_ID_PREFIX}${id}`, destination); // cache
      onChange(destination);
    },
    (err) => {
      console.error('[destinationService] subscribeDestinationById error:', err);
      // NEW — offline fallback for DestinationDetail
      const cached = getCachedDestinationById(id);
      onChange(cached ? cached.data : null);
    },
  );
}