// src/services/userProfileService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Manages user profile documents stored in Firestore (collection: "users").
//
// Profile pictures are compressed client-side with Canvas and stored as
// base64 data-URLs directly in Firestore (avoids Firebase Storage billing).
// Compressed images are kept under ~700 KB (Firestore 1 MB doc limit is safe).
//
// Exports consumed by the app:
//   profile.tsx → createUserProfile, getUserProfile, updateUserProfile,
//                 uploadProfilePicture, UserProfile, UserName
//   home.tsx    → getUserProfile
// ─────────────────────────────────────────────────────────────────────────────

import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { firestore } from '../firebase';
import { useState, useEffect, useCallback } from 'react';
// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserName {
  firstname?: string;
  surname?:   string;
  suffix?:    string;
}

export interface UserProfile {
  name?:              UserName;
  email?:             string;
  dateOfBirth?:       string;   // ISO date string "YYYY-MM-DD"
  nickname?:          string;
  img?:               string | null;  // base64 data-URL or remote URL
  nationality?:       string;
  address?:           string;
  contactNumber?:     string;
  gender?:            string;
  isGoogleUser?:      boolean;
  isFullyRegistered?: boolean;
  createdAt?:         string;
  // Allow extra Firestore fields
  [key: string]: any;
}


interface UserCoords {
  latitude: number;
  longitude: number;
}

// ── Firestore ref helper ──────────────────────────────────────────────────────

const userRef = (uid: string) => doc(firestore, 'users', uid);

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * createUserProfile
 * Creates (or overwrites) the user's Firestore document.
 * Called after registration or first Google sign-in.
 */
export const createUserProfile = async (
  userId:      string,
  profileData: Partial<UserProfile>,
): Promise<void> => {
  try {
    const data = {
      name: profileData.name || {
        firstname: '',
        surname:   '',
        suffix:    '',
      },
      email:             profileData.email             || '',
      dateOfBirth:       profileData.dateOfBirth       || '',
      nationality:       profileData.nationality       || '',
      nickname:          profileData.nickname          || '',
      img:               profileData.img               ?? null,
      address:           profileData.address           || '',
      contactNumber:     profileData.contactNumber     || '',
      gender:            profileData.gender            || '',
      isGoogleUser:      profileData.isGoogleUser      || false,
      isFullyRegistered: profileData.isFullyRegistered || false,
      createdAt:         profileData.createdAt         || new Date().toISOString(),
    };
    await setDoc(userRef(userId), data);
  } catch (err: any) {
    console.error('[userProfileService] createUserProfile failed:', err);
    if (err.code === 'permission-denied') {
      throw new Error('Permission denied — check your Firestore security rules.');
    }
    throw err;
  }
};

/**
 * getUserProfile
 * Returns the user's profile or null if the document doesn't exist yet.
 */
export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  try {
    const snap = await getDoc(userRef(userId));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  } catch (err: any) {
    console.error('[userProfileService] getUserProfile failed:', err);
    if (err.code === 'permission-denied') {
      throw new Error('Permission denied — check your Firestore security rules.');
    }
    throw err;
  }
};

/**
 * updateUserProfile
 * Merges partial changes into an existing document.
 * Only the provided fields are written; everything else is untouched.
 */
export const updateUserProfile = async (
  userId:      string,
  profileData: Partial<UserProfile>,
): Promise<void> => {
  try {
    await updateDoc(userRef(userId), profileData as Record<string, any>);
  } catch (err: any) {
    console.error('[userProfileService] updateUserProfile failed:', err);
    throw err;
  }
};

export function useUserLocation() {
  const [coords,          setCoords]          = useState<UserCoords | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [locationError,   setLocationError]   = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by this browser.');
      setLocationLoading(false);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocationLoading(false);
        setLocationError(null);
      },
      (err) => {
        setLocationError(err.message);
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return { coords, locationLoading, locationError };
}


/**
 * uploadProfilePicture
 * Compresses the image client-side (Canvas → JPEG, max 500×500 px, quality 0.8)
 * and stores the resulting base64 data-URL in the user's Firestore document.
 *
 * Returns the data-URL so the UI can display it immediately.
 *
 * NOTE: Firestore documents have a 1 MB limit.
 * A 500×500 JPEG at q=0.8 is typically 60–200 KB — well within limit.
 */
export const uploadProfilePicture = async (
  userId: string,
  file:   File,
): Promise<string> => {
  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are supported.');
  }

  // Compress via Canvas
  const base64DataUrl = await new Promise<string>((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const MAX = 500;
      let { width, height } = img;

      if (width > height) {
        if (width > MAX) { height = Math.round((height * MAX) / width); width = MAX; }
      } else {
        if (height > MAX) { width = Math.round((width * MAX) / height); height = MAX; }
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for compression.'));
    };

    img.crossOrigin = 'anonymous';
    img.src = objectUrl;
  });

  // Guard against rare edge cases where compression still exceeds Firestore limit
  const approxBytes = Math.ceil((base64DataUrl.length * 3) / 4);
  if (approxBytes > 900_000) {
    throw new Error('Compressed image is still too large. Please choose a smaller photo.');
  }

  // Persist to Firestore
  await updateUserProfile(userId, { img: base64DataUrl });

  return base64DataUrl;
};