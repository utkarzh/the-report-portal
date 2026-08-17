import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isInterviewType } from '@/lib/meeting-prep'

// POST /api/meeting-prep — Step 1 of the brief: captures interviewee/meeting
// details + the optional advertiser-history check (auto-filled from the
// tracker where available, otherwise 'not_aware'), looks up the Media
// Library profile for the selected publication, and creates the session row.
// No Claude call happens here — research only starts once the client calls
// /api/meeting-prep/[id]/research, so a missing media profile halts with zero
// API cost (US-022).
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status, can_access_meeting_preparation')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (profile.role !== 'admin' && !profile.can_access_meeting_preparation) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const {
    intervieweeName,
    intervieweeTitle,
    intervieweeType,
    companyOrg,
    companyCountry,
    publication,
    publicationCountry,
    advertiserHistoryStatus,
    advertiserHistoryDetails,
  } = body

  if (!intervieweeName || !intervieweeTitle || !companyOrg || !companyCountry || !publication || !publicationCountry) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
  }
  if (!isInterviewType(intervieweeType)) {
    return NextResponse.json({ error: 'Invalid interviewee type.' }, { status: 400 })
  }
  // Optional: reps often genuinely don't know, so a blank answer defaults to
  // 'not_aware' rather than forcing a guess just to submit the form.
  if (advertiserHistoryStatus && !['yes', 'no', 'not_aware'].includes(advertiserHistoryStatus)) {
    return NextResponse.json({ error: 'Invalid advertiser history value.' }, { status: 400 })
  }
  if (advertiserHistoryStatus === 'yes' && !advertiserHistoryDetails?.trim()) {
    return NextResponse.json({ error: 'Please note the publication, space and approximate period.' }, { status: 400 })
  }

  // Step 1's media-profile gate: halt cleanly (no session, no API cost) if the
  // selected publication has no Media Library entry yet.
  const { data: media } = await supabaseAdmin
    .from('meeting_prep_media_library')
    .select('id, positioning_statement, audience_reach, editorial_narrative_focus')
    .eq('publication_name', publication)
    .maybeSingle()

  if (!media) {
    return NextResponse.json(
      { error: `No media profile exists for "${publication}" yet. Ask an admin to add one in the Meeting Preparation admin area before this can proceed.` },
      { status: 422 },
    )
  }

  const { data: session, error } = await supabaseAdmin
    .from('meeting_prep_sessions')
    .insert({
      user_id: user.id,
      interviewee_name: intervieweeName,
      interviewee_title: intervieweeTitle,
      interviewee_type: intervieweeType,
      company_org: companyOrg,
      company_country: companyCountry,
      publication,
      publication_country: publicationCountry,
      media_library_id: media.id,
      media_positioning_snapshot: media.positioning_statement,
      media_audience_reach_snapshot: media.audience_reach,
      media_narrative_snapshot: media.editorial_narrative_focus,
      advertiser_history_status: advertiserHistoryStatus || 'not_aware',
      advertiser_history_details: advertiserHistoryDetails?.trim() || null,
      stage: 'input',
    })
    .select('id')
    .single()

  if (error || !session) {
    return NextResponse.json({ error: error?.message || 'Failed to create session' }, { status: 500 })
  }

  return NextResponse.json({ id: session.id }, { status: 201 })
}
