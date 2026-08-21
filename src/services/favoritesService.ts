// src/services/favoritesService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Manages per-user favorites stored in Firestore.
//
// Collection path:  favorites/{uid}/items/{destId}
//
// Exports consumed by the app:
//   home.tsx           → toggleFavorite, subscribeFavoriteIds
//   Favorites.tsx      → subscribeFavorites, removeFavorite, FavoriteEntry
//   DestinationDetail  → toggleFavorite, getFavoriteIds
// ─────────────────────────────────────────────────────────────────────────────

import {
  collection, doc,
  setDoc, deleteDoc, getDocs,
  query, orderBy, onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { firestore } from '../firebase';
import { Destination } from '../types';

// ── FavoriteEntry — what we store per item ────────────────────────────────────

export interface FavoriteEntry {
  id:       string;
  name:     string;
  image:    string;
  address:  string;
  rating:   string;
  addedAt:  number;   // Unix ms timestamp — used for newest-first sort
}

// ── Firestore refs ────────────────────────────────────────────────────────────

const itemsCol = (uid: string) =>
  collection(firestore, 'favorites', uid, 'items');

const itemDoc = (uid: string, destId: string) =>
  doc(firestore, 'favorites', uid, 'items', destId);

// ── Write helpers ─────────────────────────────────────────────────────────────

export async function addFavorite(uid: string, dest: Destination): Promise<void> {
  const entry: FavoriteEntry = {
    id:      dest.id,
    name:    dest.title || dest.name || '',
    image:   dest.image || dest.imageUrl || '',
    address: dest.address || '',
    rating:  String(dest.rating ?? ''),
    addedAt: Date.now(),
  };
  await setDoc(itemDoc(uid, dest.id), entry);
}

export async function removeFavorite(uid: string, destId: string): Promise<void> {
  await deleteDoc(itemDoc(uid, destId));
}

/**
 * toggleFavorite
 * Adds or removes the favorite and returns the NEW isFavorite boolean.
 * Used by home.tsx and DestinationDetail.
 */
export async function toggleFavorite(
  uid:              string,
  dest:             Destination,
  currentlyFavorite: boolean,
): Promise<boolean> {
  if (currentlyFavorite) {
    await removeFavorite(uid, dest.id);
    return false;
  }
  await addFavorite(uid, dest);
  return true;
}

// ── One-time reads ────────────────────────────────────────────────────────────

/**
 * getFavoriteIds
 * Returns a Set of favorited destination IDs.
 * Used by DestinationDetail to know the initial heart state.
 */
export async function getFavoriteIds(uid: string): Promise<Set<string>> {
  try {
    const snap = await getDocs(itemsCol(uid));
    return new Set(snap.docs.map(d => d.id));
  } catch (err) {
    console.error('[favoritesService] getFavoriteIds failed:', err);
    return new Set();
  }
}

/**
 * getFavorites
 * Returns full entries sorted newest-first.
 */
export async function getFavorites(uid: string): Promise<FavoriteEntry[]> {
  try {
    const snap = await getDocs(query(itemsCol(uid), orderBy('addedAt', 'desc')));
    return snap.docs.map(d => d.data() as FavoriteEntry);
  } catch (err) {
    console.error('[favoritesService] getFavorites failed:', err);
    return [];
  }
}

// ── Real-time listeners ───────────────────────────────────────────────────────

/**
 * subscribeFavoriteIds
 * Streams a Set<string> of favorited IDs — used by home.tsx for live heart state.
 * Returns an unsubscribe function — call in useEffect cleanup.
 */
export function subscribeFavoriteIds(
  uid:      string,
  onChange: (ids: Set<string>) => void,
): Unsubscribe {
  return onSnapshot(
    query(itemsCol(uid)),
    (snap) => onChange(new Set(snap.docs.map(d => d.id))),
    (err)  => console.error('[favoritesService] subscribeFavoriteIds error:', err),
  );
}

/**
 * subscribeFavorites
 * Streams full FavoriteEntry[] sorted newest-first — used by Favorites.tsx.
 * Returns an unsubscribe function — call in useEffect cleanup.
 */
export function subscribeFavorites(
  uid:      string,
  onChange: (entries: FavoriteEntry[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(itemsCol(uid), orderBy('addedAt', 'desc')),
    (snap) => onChange(snap.docs.map(d => d.data() as FavoriteEntry)),
    (err)  => console.error('[favoritesService] subscribeFavorites error:', err),
  );
}