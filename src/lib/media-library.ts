import type { MediaLibraryEntry, MediaOption } from '@/types'

// The central Media Library (migration 039): one admin-managed list of
// publications every module picks its media partner from. Client-safe —
// the server-side queries live in media-library-server.ts.

export const MEDIA_LIBRARY_PATH = '/admin/media-library'

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
