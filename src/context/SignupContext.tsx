// src/context/SignupContext.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Holds the in-progress signup form data across the 3-step flow:
//   SignUP1 → SignUP2 → SignUP3  (email signup)
//   Login   → GoogleUserProfile  (Google signup)
//
// Consumed by every auth page via:
//   import { useSignup } from '../../context/SignupContext'
//   const { signupData, updateSignupData, resetSignupData } = useSignup();
//
// SignupData fields — every field used across all pages:
//   Step 1 (SignUP1)    : firstName, surname, suffix
//   Step 2 (SignUP2)    : email, password
//   Step 3 (SignUP3)    : username, dateOfBirth, nationality, acceptedTerms, profilePic
//   Google flow (Login) : isGoogleUser, uid
//   Shared              : all of the above
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  createContext, useContext, useState, ReactNode,
} from 'react';

// ── Data shape ────────────────────────────────────────────────────────────────

export interface SignupData {
  // Step 1 — Personal Info
  firstName:     string;
  surname:       string;
  suffix:        string;

  // Step 2 — Account credentials
  email:         string;
  password:      string;

  // Step 3 — Profile
  username:      string;
  dateOfBirth:   string;
  age:           string;
  gender:        string;
  nationality:   string;
  address:       string;
  acceptedTerms: boolean;
  profilePic:    string | null;   // base64 data-URL preview

  // Google signup extras
  isGoogleUser:  boolean;
  uid:           string;          // Firebase UID (set after Google sign-in)
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_SIGNUP_DATA: SignupData = {
  firstName:     '',
  surname:       '',
  suffix:        '',
  email:         '',
  password:      '',
  username:      '',
  dateOfBirth:   '',
  age:           '',
  gender:        '',
  nationality:   '',
  address:       '',
  acceptedTerms: false,
  profilePic:    null,
  isGoogleUser:  false,
  uid:           '',
};

// ── Context value shape ───────────────────────────────────────────────────────

interface SignupContextValue {
  signupData:      SignupData;
  /** Merge partial changes — only provided fields are overwritten */
  updateSignupData: (changes: Partial<SignupData>) => void;
  /** Reset all fields back to defaults (call after successful registration) */
  resetSignupData:  () => void;
}

// ── Context + Provider ────────────────────────────────────────────────────────

const SignupContext = createContext<SignupContextValue | undefined>(undefined);

export const SignupProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [signupData, setSignupData] = useState<SignupData>(DEFAULT_SIGNUP_DATA);

  const updateSignupData = (changes: Partial<SignupData>) => {
    setSignupData(prev => ({ ...prev, ...changes }));
  };

  const resetSignupData = () => {
    setSignupData(DEFAULT_SIGNUP_DATA);
  };

  return (
    <SignupContext.Provider value={{ signupData, updateSignupData, resetSignupData }}>
      {children}
    </SignupContext.Provider>
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useSignup = (): SignupContextValue => {
  const ctx = useContext(SignupContext);
  if (!ctx) throw new Error('useSignup() must be used inside <SignupProvider>');
  return ctx;
};

export default SignupContext;