// src/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types used across pages and services.
// ─────────────────────────────────────────────────────────────────────────────

// ── InfoBlock — used by DestinationDetail for structured content sections ────
export interface InfoBlock {
  title:      string;
  type:       'none' | 'bullet' | 'check';
  plainText?: string;
  items:      string[];
}

// ── Destination — the canonical shape returned by destinationService ─────────
export interface Destination {
  id:          string;

  // Name — Firestore docs may use either field; services normalise both
  name:        string;
  title?:      string;

  // Description
  description?: string;
  desc?:        string;

  // Images
  image?:      string;
  imageUrl?:   string;

  // Location metadata
  address?:    string;
  location?: {
    lat?:       number;
    lng?:       number;
    latitude?:  number;
    longitude?: number;
  };

  // Rating / reviews
  rating?:     number | string;
  reviews?:    number | string;   // review count

  // Discovery metadata
  category?:   string;
  ranking?:    number | string;   // for ribbon badge "#1"
  recommended?: boolean;

  // Visitor info (used by DestinationDetail)
  infoBlocks?: InfoBlock[];

  // Allow any extra Firestore fields (hours, admission, proTips, etc.)
  [key: string]: any;
}