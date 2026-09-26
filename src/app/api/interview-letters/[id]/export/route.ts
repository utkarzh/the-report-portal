import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildInterviewLetterDocx } from '@/lib/interview-letter-docx'
import { renderInterviewLetterPdf } from '@/lib/interview-letter-pdf'
import { getTemplate, resolveTemplateForPartner } from '@/lib/download-templates/registry'
import { getApiUser } from '@/lib/auth/api-user'

// GET /api/interview-letters/[id]/export — US-059. Serves the approved
// master letter as a real Word (.docx) or PDF file, with the same branded
// letterhead (logo band, partner badge, footer address) as Topic Outline/
// Transcript downloads. Owner or admin only. Exporting never changes
// approval state or triggers any AI call.
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: project } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('id, user_id, company, project_country, media_partner, master_letter, created_at')
    .eq('id', params.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!project.master_letter) {
    return NextResponse.json({ error: 'Letter not available yet' }, { status: 404 })
  }

  // `template` comes from DownloadTemplateModal when the user picked one;
  // falling back to a media_partner match keeps direct/bookmarked links
  // (no query params) branded correctly instead of defaulting blindly.
  const templateId = request.nextUrl.searchParams.get('template')
  const template = templateId ? getTemplate(templateId) : resolveTemplateForPartner(project.company, project.media_partner)
  const format = request.nextUrl.searchParams.get('format') === 'pdf' ? 'pdf' : 'docx'

  const meta = {
    company: project.company,
    project_country: project.project_country,
    media_partner: project.media_partner,
    created_at: project.created_at,
  }
  const base = `${project.company} — ${project.media_partner}`.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'interview-letter'

  if (format === 'pdf') {
    const buffer = await renderInterviewLetterPdf(project.master_letter, meta, template)
    const filename = `${base} — Interview Letter.pdf`
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const doc = buildInterviewLetterDocx(project.master_letter, meta, template)
  const buffer = await Packer.toBuffer(doc)
  const filename = `${base} — Interview Letter.docx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
