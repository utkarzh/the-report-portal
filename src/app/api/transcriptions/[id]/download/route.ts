import { NextRequest, NextResponse } from 'next/server'
import { Document, Packer, Paragraph, HeadingLevel } from 'docx'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { letterheadHeaderFooter, markdownToParagraphs } from '@/lib/docx-render'

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
        ...letterheadHeaderFooter(),
        children: [
          new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1 }),
          // Highlight [[ … ]] client-confirmation spans yellow on the refined variant.
          ...markdownToParagraphs(text, { highlightConfirm: variant === 'refined' }),
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

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'transcript'
}
