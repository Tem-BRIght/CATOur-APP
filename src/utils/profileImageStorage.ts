const PROFILE_PIC_KEY = 'profilePic';

export function getProfilePicCache(): string | null {
  if (typeof window === 'undefined') return null;

  for (const value of [
    sessionStorage.getItem(PROFILE_PIC_KEY),
    localStorage.getItem(PROFILE_PIC_KEY),
  ]) {
    if (!value) continue;
    if (value.startsWith('data:image/')) return value;
  }

  return null;
}

export function setProfilePicCache(value: string | null): void {
  if (typeof window === 'undefined') return;

  try {
    if (!value) {
      sessionStorage.removeItem(PROFILE_PIC_KEY);
      localStorage.removeItem(PROFILE_PIC_KEY);
      return;
    }

    if (!value.startsWith('data:image/')) return;

    const safeValue = value.slice(0, 900_000);
    sessionStorage.setItem(PROFILE_PIC_KEY, safeValue);
    localStorage.setItem(PROFILE_PIC_KEY, safeValue);
  } catch (err) {
    console.warn('[profileImageStorage] Failed to write profile picture cache:', err);
  }
}
