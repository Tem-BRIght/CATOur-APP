import type { Timestamp } from 'firebase/firestore';

export interface UserAddress {
  region?: string;
  city?:   string;
  brgy?:   string;
}

export interface UserProfile {
  id?: string;
  displayName?: string | null;
  name: {
    firstname: string;
    surname: string;
    suffix?: string;
  };
  email: string;
  dateOfBirth: string;
  nickname?: string;
  img?: string;
  nationality?: string;
  address?: UserAddress | string;
  contactNumber?: string;
  gender?: string;
  religion?: string;
  isGoogleUser?: boolean;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  createdAt?: string;
  isFullyRegistered?: boolean;
  age?: number | string;
  role?: string;
  status: string;
  lastActive: Timestamp;
  mustChangePassword?: boolean;
}
