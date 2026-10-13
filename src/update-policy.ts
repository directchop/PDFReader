const DAY = 24 * 60 * 60 * 1000;

export function shouldAutoCheck(enabled: boolean, lastCheck: number | null, now: number) {
  return enabled && (lastCheck === null || now - lastCheck >= DAY);
}
