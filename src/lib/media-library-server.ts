import { supabaseAdmin } from '@/lib/supabase/admin'
import { findMedia, toMediaOption } from '@/lib/media-library'
import type { MediaLibraryEntry, MediaOption } from '@/types'

// Server-side reads of the central Media Library (migration 039).

// Every publication, alphabetical, for a module's dropdown.
export async function listMediaOptions(): Promise<MediaOption[]> {
  const { data } = await supabaseAdmin.from('media_library').select('id, name, country').order('name')
  return (data || []).map(toMediaOption)
}

// Full entries, for modules that need their extra fields in the form.
export async function listMediaEntries(): Promise<MediaLibraryEntry[]> {
  const { data } = await supabaseAdmin.from('media_library').select('*').order('name')
  return (data || []) as MediaLibraryEntry[]
}

// The library entry for a submitted name (case/space-insensitive), or null.
export async function findMediaEntry(name: string | null | undefined): Promise<MediaLibraryEntry | null> {
  if (!name?.trim()) return null
  return findMedia(await listMediaEntries(), name) || null
}

// Create routes store the library's own spelling, so "usa today" from an old
// client or a stale tab still saves as "USA Today". A name the library
// doesn't know is kept as sent rather than rejected: the dropdown is what
// keeps new data clean, and refusing would break any older caller.
export async function canonicalMediaName(name: string | null | undefined): Promise<string> {
  const trimmed = (name || '').trim()
  const entry = await findMediaEntry(trimmed)
  return entry ? entry.name : trimmed
}
