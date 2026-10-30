export const uid = () => crypto.randomUUID();

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (n: number | null | undefined) => (n == null ? '—' : usd.format(n));

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Today's date on this device, "2026-10-30". */
export const localDay = () => new Date().toLocaleDateString('en-CA');

/** A card's release date for display: "Mar 8, 2024", or "Coming Nov 20, 2026" when it isn't out yet. */
export function fmtRelease(day: string, short = false): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y) return '';
  const date = new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, short ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  return day > localDay() ? `Coming ${date}` : date;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
