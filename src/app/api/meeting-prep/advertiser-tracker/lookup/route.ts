import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { matchAdvertiserHistory, type TrackerEntry } from '@/lib/meeting-prep-tracker'

export const runtime = 'nodejs'

// GET /api/meeting-prep/advertiser-tracker/lookup?country=&company=
// Auto-matches the company in that country's tracker and returns an editable
// Commercial Alert (status + details). Used by the meeting-prep form.
export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const country = (request.nextUrl.searchParams.get('country') || '').trim()
  const company = (request.nextUrl.searchParams.get('company') || '').trim()
  if (!country || !company) {
    return NextResponse.json({ error: 'country and company are required' }, { status: 400 })
  }

  const { data: tracker } = await supabase
    .from('meeting_prep_advertiser_tracker')
    .select('entries, filename, updated_at')
    .ilike('country', country)
    .maybeSingle()

  if (!tracker) {
    // No tracker on file for this country — the user is told to upload one.
    return NextResponse.json({ trackerFound: false })
  }

  const match = matchAdvertiserHistory((tracker.entries as TrackerEntry[]) || [], company)
  return NextResponse.json({
    trackerFound: true,
    filename: tracker.filename,
    updatedAt: tracker.updated_at,
    status: match.status,
    details: match.details,
    hasHistory: match.hasHistory,
    matchCount: match.matchedRows.length,
  })
}
