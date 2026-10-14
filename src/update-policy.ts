const DAY = 24 * 60 * 60 * 1000;

export function shouldAutoCheck(enabled: boolean, lastCheck: number | null, now: number) {
  return enabled && (lastCheck === null || now - lastCheck >= DAY);
}

export function formatUpdateDate(value: string | null, locale: string) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
