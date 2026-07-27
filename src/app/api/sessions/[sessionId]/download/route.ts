import { NextRequest, NextResponse } from 'next/server'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { letterheadHeaderFooter, markdownToParagraphs } from '@/lib/docx-render'

// Generates a Word (.docx) file from an interview's research or questions
// output, with the Report Company letterhead (logo header + footer/page number).
export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const type = request.nextUrl.searchParams.get('type') === 'questions'
    ? 'questions'
    : 'research'

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
  const filename = `${subjectSafe} — ${heading}.docx`

  // Subject metadata as compact bold-labelled lines under the heading.
  const metaRows: [string, string | null][] = [
    ['Subject', session.full_name],
    ['Title', session.title_position],
    ['Organisation', session.company_org],
    ['Country', session.country_focus],
    ['Type', session.category_name],
    ['Publication', session.publication],
    ['Media Partner', session.media_partner_country],
  ]
  const metaParas = metaRows
    .filter(([, v]) => v)
    .map(([k, v]) =>
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: `${k}: `, bold: true, size: 18 }),
          new TextRun({ text: String(v), size: 18 }),
        ],
      }),
    )

  const doc = new Document({
    sections: [
      {
        ...letterheadHeaderFooter(),
        children: [
          new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1 }),
          ...metaParas,
          new Paragraph({ text: '', spacing: { after: 120 } }),
          ...markdownToParagraphs(markdown),
        ],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
