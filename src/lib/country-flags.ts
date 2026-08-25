import { flag, countries } from 'country-emoji'

// Cash Box project `country` was originally free text (see
// NewProjectModal.tsx) — a typo there silently broke the flag lookup below
// AND the per-country weekend rules in finance-flags.ts, so project creation
// now picks from this same canonical list instead. countryFlag() keeps the
// fallback for any pre-existing free-text rows that don't exactly match.
export function countryFlag(country: string): string {
  return flag(country) || '🏳️'
}

export interface CountryOption {
  name: string
  flag: string
}

// Every option is guaranteed to resolve a flag (built from the same table
// countryFlag() reads), sorted for a sane search/scroll order.
export const COUNTRY_OPTIONS: CountryOption[] = Object.entries(countries)
  .map(([code, [name]]) => ({ name, flag: flag(code) || '🏳️' }))
  .sort((a, b) => a.name.localeCompare(b.name))
