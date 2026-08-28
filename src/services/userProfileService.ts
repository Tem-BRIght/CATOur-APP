// src/services/userProfileService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Manages user profile documents stored in Firestore (collection: "users").
// ─────────────────────────────────────────────────────────────────────────────

import { doc, setDoc, getDoc } from 'firebase/firestore';
import { firestore } from '../firebase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserName {
  firstname?: string;
  surname?:   string;
  suffix?:    string;
}

export interface UserAddress {
  region?: string;
  city?:   string;
  brgy?:   string;
}

export interface UserProfile {
  name?:              UserName;
  email?:             string;
  dateOfBirth?:       string;
  age?:               string;
  nickname?:          string;
  img?:               string | null;
  nationality?:       string;
  // Keep `address` as the freeform string (signup/admin may set this)
  address?:           UserAddress | string;
  // New: always store a structured form alongside the string to enable
  // reliable reads by admin UIs and queries.
  addressStructured?: UserAddress;
  contactNumber?:     string;
  gender?:            string;
  religion?:          string;
  isGoogleUser?:      boolean;
  emailVerified?:     boolean;
  phoneVerified?:     boolean;
  isFullyRegistered?: boolean;
  acceptedTerms?:     boolean;
  createdAt?:         string;
  deletionStatus?:    'active' | 'scheduled';
  deletionAt?:        any;
  [key: string]: any;
}

// ── Firestore ref helper ──────────────────────────────────────────────────────

const userRef = (uid: string) => doc(firestore, 'users', uid);

function cleanAddressString(address?: any): string {
  if (!address) return '';
  if (typeof address === 'string') return address.trim();
  if (typeof address === 'object') {
    if (address.full) return String(address.full).trim();
    const parts = [address.brgy || address.barangay, address.city, address.district, address.region].filter(Boolean);
    return parts.join(', ');
  }
  return String(address).trim();
}

function buildAddressFields(address?: UserAddress | string) {
  if (!address) return { addressString: '', addressStructured: { region: '', city: '', brgy: '' } };

  if (typeof address === 'string') {
    const raw = address.trim();
    // Try to split into brgy, city, region when comma-separated
    const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      return { addressString: raw, addressStructured: { brgy: parts[0], city: parts[1], region: parts[2] } };
    }
    if (parts.length === 2) {
      return { addressString: raw, addressStructured: { brgy: '', city: parts[0], region: parts[1] } };
    }
    return { addressString: raw, addressStructured: { brgy: '', city: raw, region: '' } };
  }

  return {
    addressString: [address.brgy, address.city, address.region].filter(Boolean).join(', '),
    addressStructured: {
      region: address.region ?? '',
      city:   address.city ?? '',
      brgy:   address.brgy ?? '',
    },
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export const createUserProfile = async (
  userId:      string,
  profileData: Partial<UserProfile>,
): Promise<void> => {
  try {
    const { addressString, addressStructured } = buildAddressFields(profileData.address as any);
    const data = {
      name: profileData.name || { firstname: '', surname: '', suffix: '' },
      email:             profileData.email             || '',
      dateOfBirth:       profileData.dateOfBirth       || '',
      age:               profileData.age               ?? '',
      nationality:       profileData.nationality       || '',
      nickname:          profileData.nickname          || '',
      img:               profileData.img               ?? null,
      // store both the freeform string and the structured parts
      address:           addressString || '',
      addressStructured: addressStructured || { region: '', city: '', brgy: '' },
      contactNumber:     profileData.contactNumber     || '',
      gender:            profileData.gender            || '',
      religion:          profileData.religion          || '',
      isGoogleUser:      profileData.isGoogleUser      || false,
      emailVerified:     profileData.emailVerified     || false,
      phoneVerified:     profileData.phoneVerified     || false,
      isFullyRegistered: profileData.isFullyRegistered || false,
      acceptedTerms:     profileData.acceptedTerms     || false,
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

// ─ Percentage ──────────────────────────────────────────────────────────────────────

const TRACKED_FIELDS: { check: (p: UserProfile) => boolean }[] = [
  { check: p => !!p.name?.firstname?.trim() },
  { check: p => !!p.name?.surname?.trim() },
  { check: p => !!p.nickname?.trim() },
  { check: p => !!p.email?.trim() && p.emailVerified === true },
  { check: p => !!p.dateOfBirth?.trim() },
  { check: p => !!p.gender?.trim() },
  { check: p => !!p.nationality?.trim() },
  { check: p => !!p.religion?.trim() },
  { check: p => {
      if (!p.address) return false;
      if (typeof p.address === 'string') return !!p.address.trim();
      return !!(p.address.region || p.address.city || p.address.brgy);
    }
  },
  { check: p => !!p.img },
];

export function getProfileCompletion(profile: UserProfile | null): number {
  if (!profile) return 0;
  const filled = TRACKED_FIELDS.filter(f => f.check(profile)).length;
  return Math.round((filled / TRACKED_FIELDS.length) * 100);
}

export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  try {
    const snap = await getDoc(userRef(userId));
    if (!snap.exists()) return null;
    const data = snap.data() as UserProfile;
    if (data.address && typeof data.address !== 'string') {
      data.address = cleanAddressString(data.address);
    }
    return data;
  } catch (err: any) {
    const code = typeof err?.code === 'string' ? err.code.toLowerCase() : '';
    const message = typeof err?.message === 'string' ? err.message.toLowerCase() : '';

    if (code === 'permission-denied'
      || message.includes('permission denied')
      || message.includes('missing or insufficient permissions')
      || message.includes('insufficient permissions')) {
      return null;
    }
    console.error('[userProfileService] getUserProfile failed:', err);
    throw err;
  }
};

export const updateUserProfile = async (
  userId:      string,
  profileData: Partial<UserProfile>,
): Promise<void> => {
  try {
    // If address is provided, expand it into both string + structured fields
    const payload: Record<string, any> = { ...profileData } as Record<string, any>;
    if (profileData.address !== undefined) {
      const { addressString, addressStructured } = buildAddressFields(profileData.address as any);
      payload.address = addressString;
      payload.addressStructured = addressStructured;
    }

    await setDoc(userRef(userId), payload, { merge: true });
  } catch (err: any) {
    console.error('[userProfileService] updateUserProfile failed:', err);
    throw err;
  }
};

export const uploadProfilePicture = async (
  userId: string,
  file:   File,
): Promise<string> => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are supported.');
  }

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

  const approxBytes = Math.ceil((base64DataUrl.length * 3) / 4);
  if (approxBytes > 900_000) {
    throw new Error('Compressed image is still too large. Please choose a smaller photo.');
  }

  await updateUserProfile(userId, { img: base64DataUrl });
  return base64DataUrl;
};
