import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getTemplate } from '@/lib/download-templates/registry'
import { buildTemplatedDocx } from '@/lib/download-templates/docx'
import { renderTemplatedPdf } from '@/lib/download-templates/pdf'
import { TRANSLATION_LANGUAGES_WITHOUT_PDF, type TranslationLanguage } from '@/lib/transcriptions'
import { joinIdentityForFilename, sanitizeFilename } from '@/lib/docx-standard-format'

export const runtime = 'nodejs'

// GET /api/transcriptions/[id]/download?variant=raw|refined|translated&template=&format=
// Returns the chosen transcript styled to a branded template, as PDF or Word.
// Owner or admin.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

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
  const format = request.nextUrl.searchParams.get('format') === 'pdf' ? 'pdf' : 'docx'
  const template = getTemplate(request.nextUrl.searchParams.get('template'))

  const { data: row } = await supabaseAdmin
    .from('transcriptions')
    .select('user_id, title, raw_transcript, refined_transcript, translated_transcript, translation_language, full_name, title_position, company_org, publication')
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
  // The PDF font is a Latin+Cyrillic-only subset (see fonts.ts) — CJK glyphs
  // silently render broken rather than erroring, so block it outright instead.
  if (
    format === 'pdf' &&
    variant === 'translated' &&
    TRANSLATION_LANGUAGES_WITHOUT_PDF.includes(row.translation_language as TranslationLanguage)
  ) {
    return NextResponse.json(
      { error: `PDF export isn't supported for ${row.translation_language} translations — download Word instead.` },
      { status: 422 },
    )
  }

  const title = row.title || 'Transcript'
  const label =
    variant === 'refined' ? 'Refined'
    : variant === 'translated' ? `Translated${row.translation_language ? ` (${row.translation_language})` : ''}`
    : 'Raw'
  const heading = `${title} — ${label} transcript`
  const header = {
    title: 'Interview Transcript',
    name: row.full_name || '',
    designation: row.title_position || '',
    companyOrMinistry: row.company_org || '',
    mediaName: row.publication || '',
  }

  let body: BodyInit
  let contentType: string
  if (format === 'pdf') {
    // Highlight [[ … ]] client-confirmation spans yellow on the refined variant
    // (mirrors the docx path); otherwise the raw markers leak into the PDF.
    // `header` was previously omitted here — PDF transcript downloads never
    // got the standardised title/byline/"For publication in" header the docx
    // path renders, and fell back to a plain single-line heading instead.
    // Transcript typography: 12pt body/pull-quotes, 11pt disclaimer — scoped
    // here so Topic Outline/Research PDFs (which share this same renderer)
    // keep their existing 10.5pt look untouched.
    body = new Uint8Array(
      await renderTemplatedPdf({
        markdown: text,
        heading,
        template,
        highlightConfirm: variant === 'refined',
        header,
        bodyFontSize: 12,
        disclaimerFontSize: 11,
      }),
    ) as BodyInit
    contentType = 'application/pdf'
  } else {
    // Highlight [[ … ]] client-confirmation spans yellow on the refined variant.
    // justify: true — transcripts read as a justified block, not ragged-right.
    // bodyFontSize is in half-points (docx convention) — 24 = 12pt, matching
    // the PDF path's 12pt body/11pt disclaimer. The disclaimer keeps the
    // document's existing 11pt default, so only body text needs the override.
    const doc = buildTemplatedDocx({
      markdown: text,
      heading,
      template,
      highlightConfirm: variant === 'refined',
      header,
      justify: true,
      bodyFontSize: 24,
    })
    body = new Uint8Array(await Packer.toBuffer(doc)) as BodyInit
    contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }

  // "Transcript – Name, Title and Company" — same identity fields as the
  // standardised header, joined with the naming convention's "and" rather
  // than the header's comma-only style. Falls back to the transcription's
  // own title when the interviewee metadata is missing (rows created before
  // migration 024).
  const identity = joinIdentityForFilename([row.full_name, row.title_position, row.company_org])
  const filename = `${sanitizeFilename(`Transcript – ${identity || title}`)}.${format}`

  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
