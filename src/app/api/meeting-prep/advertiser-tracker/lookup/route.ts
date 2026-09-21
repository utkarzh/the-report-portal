import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/auth/api-user'
import { matchAdvertiserHistory, type TrackerEntry } from '@/lib/meeting-prep-tracker'

export const runtime = 'nodejs'

// GET /api/meeting-prep/advertiser-tracker/lookup?company=&country=
// Auto-matches the company against EVERY uploaded tracker pooled together —
// matching is worldwide, not scoped to the interviewee's own country, since a
// company can have advertised anywhere. `country` is accepted for backward
// compatibility but no longer used to filter. Returns an editable Commercial
// Alert (status + details). Used by the meeting-prep form.
export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const auth = await getApiUser()
  if (!auth.user) return auth.response

  const company = (request.nextUrl.searchParams.get('company') || '').trim()
  if (!company) {
    return NextResponse.json({ error: 'company is required' }, { status: 400 })
  }

  const { data: trackers } = await supabase
    .from('meeting_prep_advertiser_tracker')
    .select('entries, updated_at')

  if (!trackers || trackers.length === 0) {
    // No tracker on file at all — the user is told to upload one.
    return NextResponse.json({ trackerFound: false })
  }

  const allEntries = trackers.flatMap((t) => (t.entries as TrackerEntry[]) || [])
  const updatedAt = trackers.reduce<string | null>(
    (latest, t) => (!latest || t.updated_at > latest ? t.updated_at : latest),
    null,
  )

  const match = matchAdvertiserHistory(allEntries, company)
  return NextResponse.json({
    trackerFound: true,
    updatedAt,
    status: match.status,
    details: match.details,
    hasHistory: match.hasHistory,
    matchCount: match.matchedRows.length,
  })
}
