export function canTriggerVibration(navigatorLike: Navigator | undefined): boolean {
  if (!navigatorLike?.vibrate) return false;

  const userActivation = (navigatorLike as Navigator & { userActivation?: { isActive?: boolean } }).userActivation;
  const hasUserActivation = userActivation?.isActive === true;

  return hasUserActivation;
}

export function safeVibrate(navigatorLike: Navigator | undefined, pattern: number | number[] | VibratePattern = 60): boolean {
  if (!canTriggerVibration(navigatorLike)) return false;

  navigatorLike?.vibrate?.(pattern);
  return true;
}
