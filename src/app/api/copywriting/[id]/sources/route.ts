import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { denyWithoutCopywritingAccess } from '@/lib/copywriting-access'
import { extractSampleText } from '@/lib/sample-extract'
import { parseStagedFiles, readStagedFile, removeStagedFiles, fileViewPayload } from '@/lib/copywriting-storage'
import { PROJECT_DOCUMENTS_BUCKET, COPYWRITING_UPLOAD_EXT_RE, MAX_PROJECT_DOCUMENTS, MAX_PROJECT_SOURCE_CHARS } from '@/lib/copywriting'

interface Params {
  params: { id: string }
}

async function loadOwnedProject(id: string, userId: string) {
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  const { data: project } = await supabaseAdmin.from('copywriting_projects').select('id, user_id, stage').eq('id', id).maybeSingle()
  if (!project) return { project: null, ok: false }
  const ok = project.user_id === userId || profile?.role === 'admin'
  return { project, ok }
}

// GET ?documentId=… — the "View" button: the source's extracted text (what
// the AI reads) plus a short-lived link to the original file. Loaded on
// demand so the project page doesn't ship every source's full text.
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied

  const { project, ok } = await loadOwnedProject(params.id, auth.user.id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const documentId = request.nextUrl.searchParams.get('documentId')
  if (!documentId) return NextResponse.json({ error: 'documentId is required' }, { status: 400 })
  const { data: doc } = await supabaseAdmin
    .from('copywriting_project_documents')
    .select('filename, storage_path, extracted_text, char_count, truncated, mime')
    .eq('id', documentId)
    .eq('project_id', project.id)
    .maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await fileViewPayload(PROJECT_DOCUMENTS_BUCKET, doc))
}

// POST { files: StagedFile[] } — the writer adds everything the article
// should be built from (FLOW-02): interview transcripts, press releases,
// company/government material, supporting documents, instructions.
// The browser has ALREADY uploaded each file straight to the private
// copywriting-project-documents bucket (uploadToStorage(), like the
// Transcriptions module) under "<owner uid>/<project id>/"; this route only
// gets the paths, reads each file back from storage, extracts its text and
// records it. No file bytes pass through this request, so Vercel's ~4.5 MB
// body limit doesn't apply. Any staged file that's rejected is deleted.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied

  const { project, ok } = await loadOwnedProject(params.id, auth.user.id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const folder = `${project.user_id}/${project.id}/`
  const files = parseStagedFiles(body?.files, folder)
  if (!files) return NextResponse.json({ error: 'No valid uploaded files provided' }, { status: 400 })
  const allPaths = files.map((f) => f.path)

  if (project.stage !== 'upload') {
    await removeStagedFiles(PROJECT_DOCUMENTS_BUCKET, allPaths)
    return NextResponse.json({ error: 'Sources can only be added while the project is at the Upload step.' }, { status: 409 })
  }

  const { data: existingDocs } = await supabaseAdmin
    .from('copywriting_project_documents')
    .select('char_count')
    .eq('project_id', project.id)
  if ((existingDocs?.length ?? 0) + files.length > MAX_PROJECT_DOCUMENTS) {
    await removeStagedFiles(PROJECT_DOCUMENTS_BUCKET, allPaths)
    return NextResponse.json({ error: `A project can have at most ${MAX_PROJECT_DOCUMENTS} source documents.` }, { status: 409 })
  }

  const uploaded: unknown[] = []
  const errors: { filename: string; error: string }[] = []

  // Running total of source text already on the project (see
  // MAX_PROJECT_SOURCE_CHARS — a project-wide ceiling, not a per-file cap).
  let totalChars = (existingDocs || []).reduce((sum, d) => sum + (d.char_count || 0), 0)

  for (const file of files) {
    try {
      if (!COPYWRITING_UPLOAD_EXT_RE.test(file.filename)) throw new Error('Unsupported file type')
      const buffer = await readStagedFile(PROJECT_DOCUMENTS_BUCKET, file.path)
      const extracted = await extractSampleText(file.filename, buffer, { maxChars: null })
      if (totalChars + extracted.charCount > MAX_PROJECT_SOURCE_CHARS) {
        throw new Error(
          `Too much text for one article: this file has ${extracted.charCount.toLocaleString()} characters and the project already has ${totalChars.toLocaleString()}. All sources together can be up to ${MAX_PROJECT_SOURCE_CHARS.toLocaleString()} characters (about ${Math.round(MAX_PROJECT_SOURCE_CHARS / 6 / 1000)}k words), since Claude reads them all at once on every step.`,
        )
      }

      const { data: row, error: insertErr } = await supabaseAdmin
        .from('copywriting_project_documents')
        .insert({
          project_id: project.id,
          user_id: auth.user.id,
          filename: file.filename,
          storage_path: file.path,
          mime: file.mime,
          size_bytes: buffer.length,
          extracted_text: extracted.text,
          char_count: extracted.charCount,
          truncated: extracted.truncated,
        })
        .select('id, filename, mime, size_bytes, char_count, truncated, created_at')
        .single()
      if (insertErr || !row) throw new Error(insertErr?.message || 'Failed to save document')

      totalChars += extracted.charCount
      uploaded.push(row)
    } catch (err) {
      await removeStagedFiles(PROJECT_DOCUMENTS_BUCKET, [file.path])
      errors.push({ filename: file.filename, error: err instanceof Error ? err.message : 'Upload failed' })
    }
  }

  if (uploaded.length) {
    await supabaseAdmin.from('copywriting_project_events').insert({
      project_id: project.id,
      event_type: 'sources_uploaded',
      summary: `${uploaded.length} source document${uploaded.length === 1 ? '' : 's'} uploaded.`,
      payload: { filenames: uploaded.map((u) => (u as { filename: string }).filename) },
    })
  }

  return NextResponse.json({ uploaded, errors }, { status: uploaded.length ? 201 : 400 })
}

// DELETE /api/copywriting/[id]/sources?documentId=... — only while at Upload.
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied

  const { project, ok } = await loadOwnedProject(params.id, auth.user.id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (project.stage !== 'upload') {
    return NextResponse.json({ error: 'Sources can only be removed while the project is at the Upload step.' }, { status: 409 })
  }

  const documentId = request.nextUrl.searchParams.get('documentId')
  if (!documentId) return NextResponse.json({ error: 'documentId is required' }, { status: 400 })

  const { data: doc } = await supabaseAdmin
    .from('copywriting_project_documents')
    .select('storage_path')
    .eq('id', documentId)
    .eq('project_id', project.id)
    .maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await supabaseAdmin.storage.from(PROJECT_DOCUMENTS_BUCKET).remove([doc.storage_path])
  const { error } = await supabaseAdmin.from('copywriting_project_documents').delete().eq('id', documentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
