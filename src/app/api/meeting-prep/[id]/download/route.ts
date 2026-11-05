import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { buildMeetingPrepDocx } from '@/lib/meeting-prep-docx'
import { composeFinalDocument } from '@/lib/meeting-prep-document'
import { currentFinalSections, loadAdvertiserRecord } from '@/lib/meeting-prep-server'
import { joinIdentityForFilename, sanitizeFilename } from '@/lib/docx-standard-format'
import type { MeetingPrepSession } from '@/types'

// GET /api/meeting-prep/[id]/download — the meeting preparation document as
// a real Word (.docx) file, composed from the current blocks so it always
// matches what's on screen. Owner or admin only.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: row } = await supabaseAdmin
    .from('meeting_prep_sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const session = row as MeetingPrepSession
  const identity = joinIdentityForFilename([session.interviewee_name, session.interviewee_title, session.company_org])

  // Composed from the blocks when there are any (every document since
  // migration 044, and older ones whose numbered sections can be read back);
  // otherwise the stored text as it was written.
  const sections = currentFinalSections(session)
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || request.nextUrl.origin
  const markdown = Object.keys(sections).length
    ? composeFinalDocument(
        { ...session, final_sections: sections },
        { resourceUrl: (r) => `${origin}/api/meeting-prep/resources/${r}/download`, advertiser: await loadAdvertiserRecord(session) },
      )
    : session.final_output
  if (!markdown) {
    return NextResponse.json({ error: 'Document not available yet' }, { status: 404 })
  }

  const built = buildMeetingPrepDocx(markdown, {
    interviewee_name: session.interviewee_name,
    interviewee_title: session.interviewee_title,
    company_org: session.company_org,
    publication: session.publication,
    publication_country: session.publication_country,
    created_at: session.created_at,
  })

  const buffer = await Packer.toBuffer(built)
  // "Name, Title, Company" — no "Meeting Prep" suffix, per the
  // naming convention shared with Interview Outline/Transcript/Letter.
  const filename = `${sanitizeFilename(identity || session.interviewee_name || 'Meeting Preparation')}.docx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
