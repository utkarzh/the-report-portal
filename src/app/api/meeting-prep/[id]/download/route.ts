import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildMeetingPrepDocx } from '@/lib/meeting-prep-docx'

// GET /api/meeting-prep/[id]/download — serves the final meeting preparation
// document as a real Word (.docx) file. Owner or admin only.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: session } = await supabaseAdmin
    .from('meeting_prep_sessions')
    .select('id, user_id, interviewee_name, interviewee_title, company_org, publication, publication_country, final_output, created_at')
    .eq('id', params.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!session.final_output) {
    return NextResponse.json({ error: 'Document not available yet' }, { status: 404 })
  }

  const doc = buildMeetingPrepDocx(session.final_output, {
    interviewee_name: session.interviewee_name,
    interviewee_title: session.interviewee_title,
    company_org: session.company_org,
    publication: session.publication,
    publication_country: session.publication_country,
    created_at: session.created_at,
  })

  const buffer = await Packer.toBuffer(doc)
  const base = (session.interviewee_name || 'Meeting Preparation').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'meeting-preparation'
  const filename = `${base} — Meeting Prep.docx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
