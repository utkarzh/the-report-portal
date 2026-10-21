import type { MediaLibraryEntry, MediaOption } from '@/types'

// The central Media Library (migration 039): one admin-managed list of
// publications every module picks its media partner from. Client-safe —
// the server-side queries live in media-library-server.ts.

export const MEDIA_LIBRARY_PATH = '/admin/media-library'

// The Media Library is shared, so it's opened from several modules' admin
// pages. Each link passes `?from=<key>` and the library's back arrow and
// breadcrumbs return to that module. Allowlisted: an unknown or missing key
// (e.g. opened from the sidebar) just shows the library as a top-level page.
export const MEDIA_LIBRARY_ORIGINS = {
  copywriting: [
    { label: 'Copywriting Tool', href: '/copywriting' },
    { label: 'Admin', href: '/copywriting/admin' },
  ],
  'meeting-prep': [
    { label: 'Meeting Preparation', href: '/commercial/meeting-preparation' },
    { label: 'Admin', href: '/commercial/admin/meeting-prep' },
  ],
  'interview-letters': [
    { label: 'Interview Letters', href: '/interview-letters' },
    { label: 'Admin', href: '/admin/interview-letters' },
  ],
} satisfies Record<string, { label: string; href: string }[]>

export type MediaLibraryOrigin = keyof typeof MEDIA_LIBRARY_ORIGINS

export function parseMediaLibraryOrigin(from: string | string[] | null | undefined): MediaLibraryOrigin | null {
  return typeof from === 'string' && Object.prototype.hasOwnProperty.call(MEDIA_LIBRARY_ORIGINS, from)
    ? (from as MediaLibraryOrigin)
    : null
}

// The library (or one entry's page) with the origin carried along.
export function mediaLibraryHref(from?: MediaLibraryOrigin | null, id?: string): string {
  const path = id ? `${MEDIA_LIBRARY_PATH}/${id}` : MEDIA_LIBRARY_PATH
  return from ? `${path}?from=${from}` : path
}

// Same rule as the table's unique index: case and surrounding/double spaces
// don't make a different publication.
export function normalizeMediaName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function findMedia<T extends { name: string }>(list: T[], name: string | null | undefined): T | undefined {
  const wanted = normalizeMediaName(name)
  return wanted ? list.find((m) => normalizeMediaName(m.name) === wanted) : undefined
}

export function toMediaOption(e: Pick<MediaLibraryEntry, 'id' | 'name' | 'country'>): MediaOption {
  return { id: e.id, name: e.name, country: (e.country || '').trim() }
}

type MeetingPrepProfile = Pick<MediaLibraryEntry, 'positioning_statement' | 'audience_reach' | 'editorial_narrative_focus'>

// Meeting Prep needs a media profile before it can research (US-022).
export function hasMeetingPrepProfile(e: MeetingPrepProfile): boolean {
  return Boolean(e.positioning_statement?.trim() || e.audience_reach?.trim() || e.editorial_narrative_focus?.trim())
}

// Which modules have their extra details filled in, for the admin list.
export function mediaDetailBadges(e: MeetingPrepProfile & Pick<MediaLibraryEntry, 'letter_description' | 'writing_rules'>, guideCount = 0): string[] {
  return [
    hasMeetingPrepProfile(e) ? 'Meeting Prep profile' : '',
    e.letter_description?.trim() ? 'Letter description' : '',
    e.writing_rules?.trim() || guideCount > 0 ? `Copywriting rules${guideCount ? ` + ${guideCount} guide${guideCount === 1 ? '' : 's'}` : ''}` : '',
  ].filter(Boolean)
}
