import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getTemplate } from '@/lib/download-templates/registry'
import { buildTemplatedDocx } from '@/lib/download-templates/docx'
import { renderTemplatedPdf } from '@/lib/download-templates/pdf'

// Node runtime — @react-pdf/renderer + docx need Node APIs.
export const runtime = 'nodejs'

// Generates a downloadable file from an interview's research or questions output,
// styled to one of the branded templates (see src/lib/download-templates). The
// caller picks `template` (registry id) and `format` (docx | pdf).
export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const type = request.nextUrl.searchParams.get('type') === 'questions'
    ? 'questions'
    : 'research'
  const format = request.nextUrl.searchParams.get('format') === 'pdf' ? 'pdf' : 'docx'
  const template = getTemplate(request.nextUrl.searchParams.get('template'))

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: session } = await supabaseAdmin
    .from('research_sessions')
    .select('id, user_id, full_name, title_position, company_org, country_focus, publication, media_partner_country, category_name, initial_output, questions_output, created_at')
    .eq('id', params.sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (session.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const markdown = type === 'questions' ? session.questions_output : session.initial_output
  if (!markdown) {
    return NextResponse.json({ error: `${type} output not available` }, { status: 404 })
  }

  const heading = type === 'questions' ? 'Interview Questions' : 'Background Research'
  const subjectSafe = (session.full_name || 'Interview Subject').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'subject'
  const filename = `${subjectSafe} — ${heading}.${format}`

  const meta: [string, string | null][] = [
    ['Subject', session.full_name],
    ['Title', session.title_position],
    ['Organisation', session.company_org],
    ['Country', session.country_focus],
    ['Type', session.category_name],
    ['Publication', session.publication],
    ['Media Partner', session.media_partner_country],
  ]

  // Topic Outline (the "questions" export) gets the standardised centred-bold
  // header instead of the plain heading+meta block above. Background Research
  // isn't one of the three formatted-document tools, so it keeps the old format.
  const header = type === 'questions'
    ? {
        title: 'Interview Outline',
        name: session.full_name || '',
        designation: session.title_position || '',
        companyOrMinistry: session.company_org || '',
        mediaName: session.publication || '',
      }
    : undefined
  // "Leave one line of space between questions" — a wider paragraph gap than
  // the renderer's default, topic-outline downloads only.
  const paragraphSpacingAfter = type === 'questions' ? 240 : undefined

  let body: BodyInit
  let contentType: string
  if (format === 'pdf') {
    body = new Uint8Array(await renderTemplatedPdf({ markdown, heading, template, meta })) as BodyInit
    contentType = 'application/pdf'
  } else {
    const doc = buildTemplatedDocx({ markdown, heading, template, meta, header, paragraphSpacingAfter })
    body = new Uint8Array(await Packer.toBuffer(doc)) as BodyInit
    contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }

  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
