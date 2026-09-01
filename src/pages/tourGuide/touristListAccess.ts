export type TouristListSessionLike = {
  status?: string;
  checkedInUids?: string[];
};

export function shouldShowTouristList(session: TouristListSessionLike | null | undefined): boolean {
  if (!session || session.status !== 'active') return false;
  return Array.isArray(session.checkedInUids) && session.checkedInUids.length > 0;
}

export function isTouristListUnlocked(session: TouristListSessionLike | null | undefined): boolean {
  return shouldShowTouristList(session);
}
