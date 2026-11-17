import type { BrandFamily } from '@/lib/download-templates/registry'
import type { Agency } from '@/types'

// The central agency list (migration 047): one admin-managed list of
// agencies (The Report Company, Global FDI Reports, …) every module reads,
// the way the Media Library is the one list of publications. Client-safe —
// the server-side reads live in agencies-server.ts.
//
// Modules store an agency's CODE (TRC, GFDI, …) — Interview Letters always
// has — so renaming an agency never rewrites past work, and the codes that
// were hard-coded before are exactly the codes stored now.

export const AGENCIES_PATH = '/admin/agencies'

// The agency list is opened from several modules' admin pages; the back
// link returns to the module (same pattern as MEDIA_LIBRARY_ORIGINS).
export const AGENCY_ORIGINS = {
  'interview-letters': [
    { label: 'Interview Letters', href: '/interview-letters' },
    { label: 'Admin', href: '/admin/interview-letters' },
  ],
  'commercial-presentations': [
    { label: 'Commercial Presentations', href: '/commercial/presentations' },
    { label: 'Admin', href: '/commercial/admin/presentations' },
  ],
} satisfies Record<string, { label: string; href: string }[]>

export type AgencyOrigin = keyof typeof AGENCY_ORIGINS

export function parseAgencyOrigin(from: string | string[] | null | undefined): AgencyOrigin | null {
  return typeof from === 'string' && Object.prototype.hasOwnProperty.call(AGENCY_ORIGINS, from) ? (from as AgencyOrigin) : null
}

export function agenciesHref(from?: AgencyOrigin | null): string {
  return from ? `${AGENCIES_PATH}?from=${from}` : AGENCIES_PATH
}

export const AGENCY_CODE_RE = /^[A-Z0-9]{2,12}$/

export function isAgencyCode(v: unknown): v is string {
  return typeof v === 'string' && AGENCY_CODE_RE.test(v)
}

export function normalizeAgencyCode(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

// "Asia Business Reports" → "ABR" (the admin can change it before saving).
export function suggestAgencyCode(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
  const code = normalizeAgencyCode(initials)
  return code.length >= 2 ? code : normalizeAgencyCode(name).slice(0, 6)
}

// Branded export artwork (download-templates) exists only for TRC and GFDI
// and is chosen by the agency code. Any other agency falls back to TRC's
// set when no template is picked; the user can choose one in the download
// window. (agencies.brand_family, added by 047, is not used.)
export function brandFamilyFor(code: string | null | undefined): BrandFamily {
  return code === 'GFDI' ? 'GFDI' : 'TRC'
}

// Before migration 047 runs (or 046, which creates the table), modules fall
// back to the two agencies that used to be hard-coded, so nothing changes
// for them until the migration is applied.
export const FALLBACK_AGENCIES: Agency[] = [
  { id: 'fallback-trc', name: 'The Report Company', code: 'TRC', active: true, sort_order: 1, created_at: '', updated_at: '' },
  { id: 'fallback-gfdi', name: 'Global FDI Reports', code: 'GFDI', active: true, sort_order: 2, created_at: '', updated_at: '' },
]

export interface AgencyOption {
  value: string // the agency code
  label: string
}

export function toAgencyOption(a: Pick<Agency, 'code' | 'name'>): AgencyOption {
  return { value: a.code, label: `${a.name} (${a.code})` }
}
