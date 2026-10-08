import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor, requireGuardianForItem } from '@/lib/knowledge/access'
import { loadVersion } from '@/lib/knowledge/items'
import { extractKnowledgeText, UnreadableFileError } from '@/lib/knowledge/extract'
import { resetVersionIndex } from '@/lib/knowledge/indexing'
import { KNOWLEDGE_BUCKET, isExtractionStalled } from '@/lib/knowledge/constants'

// A 1M+ character PDF can take a while to parse.
export const maxDuration = 300

// POST /api/knowledge/versions/[id]/extract — reads the uploaded file of a
// DRAFT version into text (US-102, US-106, US-107). Driven by the Guardian's
// browser right after upload (one request per file, so a bulk upload never
// hits a single request's time limit); a stalled run can simply be retried.
// Outcome lands on the version row: ready / needs_attention (no readable
// text — can't be published) / failed (corrupt or unreadable file).
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response

  const version = await loadVersion(params.id)
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  const g = await requireGuardianForItem(actor, version.item_id)
  if (!g.item) return g.response
  if (version.published_at) return NextResponse.json({ error: 'Published versions are frozen.' }, { status: 409 })
  if (!version.file_path || !version.file_name) return NextResponse.json({ error: 'This version has no file.' }, { status: 400 })
  if (version.extraction_status === 'ready') return NextResponse.json({ version })
  if (version.extraction_status === 'processing' && !isExtractionStalled(version)) {
    return NextResponse.json({ version, inProgress: true })
  }

  await supabaseAdmin
    .from('knowledge_item_versions')
    .update({ extraction_status: 'processing', extraction_error: null, extraction_started_at: new Date().toISOString() })
    .eq('id', version.id)

  let update: Record<string, unknown>
  try {
    const { data: blob, error } = await supabaseAdmin.storage.from(KNOWLEDGE_BUCKET).download(version.file_path)
    if (error || !blob) throw new Error(error?.message || 'The uploaded file could not be found.')
    const buffer = Buffer.from(await blob.arrayBuffer())
    const { text, charCount } = await extractKnowledgeText(version.file_name, buffer)
    update = { extracted_text: text, char_count: charCount, extraction_status: 'ready', extraction_error: null }
  } catch (err) {
    if (err instanceof UnreadableFileError) {
      update = { extracted_text: null, char_count: 0, extraction_status: 'needs_attention', extraction_error: err.message }
    } else {
      console.error('[knowledge] extraction failed:', err)
      update = {
        extracted_text: null,
        char_count: 0,
        extraction_status: 'failed',
        extraction_error: 'This file couldn’t be read — it may be damaged or password-protected. Try saving it again and uploading the new copy.',
      }
    }
  }

  const { data: saved } = await supabaseAdmin
    .from('knowledge_item_versions')
    .update(update)
    .eq('id', version.id)
    .select('*')
    .single()
  if (version.index_status !== 'not_indexed') await resetVersionIndex(version.id)

  // Return the version without the (possibly huge) text body.
  const { extracted_text: _omit, ...lean } = (saved || { ...version, ...update }) as Record<string, unknown>
  void _omit
  return NextResponse.json({ version: lean })
}
