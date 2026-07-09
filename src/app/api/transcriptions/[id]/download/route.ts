import { NextRequest, NextResponse } from 'next/server'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// GET /api/transcriptions/[id]/download?variant=raw|refined
// Returns the chosen transcript as a Word (.docx) attachment. Owner or admin.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }

  const v = request.nextUrl.searchParams.get('variant')
  const variant = v === 'refined' ? 'refined' : v === 'translated' ? 'translated' : 'raw'

  const { data: row } = await supabaseAdmin
    .from('transcriptions')
    .select('user_id, title, raw_transcript, refined_transcript, translated_transcript, translation_language')
    .eq('id', params.id)
    .single()

  if (!row) return NextResponse.json({ error: 'Transcription not found' }, { status: 404 })
  if (row.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const text =
    variant === 'refined' ? row.refined_transcript
    : variant === 'translated' ? row.translated_transcript
    : row.raw_transcript
  if (!text) {
    return NextResponse.json({ error: `No ${variant} transcript available yet` }, { status: 409 })
  }

  const title = row.title || 'Transcript'
  const label =
    variant === 'refined' ? 'Refined'
    : variant === 'translated' ? `Translated${row.translation_language ? ` (${row.translation_language})` : ''}`
    : 'Raw'
  const heading = `${title} — ${label} transcript`

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1 }),
          ...toParagraphs(text),
        ],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  const filename = `${slugify(title)}-${variant}.docx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

// Converts transcript text (plain or light markdown, with "Speaker A:" labels)
// into docx paragraphs. Headings, bullets, **bold**, and bold speaker labels
// are handled; everything else is a plain paragraph.
function toParagraphs(text: string): Paragraph[] {
  const paras: Paragraph[] = []
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/)

  for (const block of blocks) {
    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim()
      if (!line) continue

      const h = /^(#{1,3})\s+(.*)$/.exec(line)
      if (h) {
        const level = h[1].length
        paras.push(
          new Paragraph({
            text: h[2],
            heading:
              level === 1 ? HeadingLevel.HEADING_1
              : level === 2 ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3,
          }),
        )
        continue
      }

      const li = /^[-*]\s+(.*)$/.exec(line)
      if (li) {
        paras.push(new Paragraph({ children: inlineRuns(li[1]), bullet: { level: 0 } }))
        continue
      }

      const sp = /^(Speaker\s+[^:]{1,40}:)\s*(.*)$/.exec(line)
      if (sp) {
        paras.push(
          new Paragraph({
            children: [new TextRun({ text: `${sp[1]} `, bold: true }), ...inlineRuns(sp[2])],
            spacing: { after: 160 },
          }),
        )
        continue
      }

      paras.push(new Paragraph({ children: inlineRuns(line), spacing: { after: 120 } }))
    }
  }

  return paras.length > 0 ? paras : [new Paragraph('')]
}

// Splits a line on **bold** spans into styled runs.
function inlineRuns(text: string): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  if (parts.length === 0) return [new TextRun('')]
  return parts.map((p) =>
    p.startsWith('**') && p.endsWith('**')
      ? new TextRun({ text: p.slice(2, -2), bold: true })
      : new TextRun(p),
  )
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'transcript'
}
