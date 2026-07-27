import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { RESEARCH_DOCS_BUCKET, MAX_RESEARCH_DOCS } from '@/lib/research-docs'
import { extractSampleText } from '@/lib/sample-extract'

// POST /api/sessions/[sessionId]/documents — records a company document that the
// browser already uploaded to the private research-documents bucket, extracts
// its text server-side (so PDF works), and links it to the interview. The
// extracted text is later injected into research + question generation as
// supporting context. Owner or admin.
export async function POST(request: NextRequest, { params }: { params: { sessionId: string } }) {
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

  const { data: session } = await supabaseAdmin
    .from('research_sessions')
    .select('id, user_id')
    .eq('id', params.sessionId)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { storagePath, filename, mime, sizeBytes } = await request.json()
  if (typeof storagePath !== 'string' || typeof filename !== 'string') {
    return NextResponse.json({ error: 'storagePath and filename are required' }, { status: 400 })
  }
  // The uploaded object must live in the caller's own folder (mirrors storage RLS).
  if (!storagePath.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 403 })
  }

  // Per-session cap.
  const { count } = await supabaseAdmin
    .from('research_documents')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', session.id)
  if ((count ?? 0) >= MAX_RESEARCH_DOCS) {
    return NextResponse.json({ error: `You can attach at most ${MAX_RESEARCH_DOCS} documents per interview.` }, { status: 409 })
  }

  const { data: blob, error: dlError } = await supabaseAdmin
    .storage
    .from(RESEARCH_DOCS_BUCKET)
    .download(storagePath)
  if (dlError || !blob) {
    return NextResponse.json({ error: 'Uploaded file not found in storage' }, { status: 400 })
  }

  let extracted
  try {
    const buffer = Buffer.from(await blob.arrayBuffer())
    extracted = await extractSampleText(filename, buffer)
  } catch (err) {
    await supabaseAdmin.storage.from(RESEARCH_DOCS_BUCKET).remove([storagePath])
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not read that document.' },
      { status: 400 },
    )
  }

  const { data: row, error: insertError } = await supabaseAdmin
    .from('research_documents')
    .insert({
      session_id: session.id,
      user_id: user.id,
      filename,
      storage_path: storagePath,
      mime: mime ?? null,
      size_bytes: typeof sizeBytes === 'number' ? sizeBytes : null,
      extracted_text: extracted.text,
      char_count: extracted.charCount,
      truncated: extracted.truncated,
    })
    .select('id, filename, size_bytes, char_count, truncated, created_at')
    .single()

  if (insertError || !row) {
    await supabaseAdmin.storage.from(RESEARCH_DOCS_BUCKET).remove([storagePath])
    return NextResponse.json({ error: 'Failed to save document' }, { status: 500 })
  }

  return NextResponse.json({ document: row }, { status: 201 })
}
