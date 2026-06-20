import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware className combiner (shadcn convention). */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Compact number / date helpers for the clinical data surface. */
export const fmtInt = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString());

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function titleCase(s) {
  if (!s) return '';
  return String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
