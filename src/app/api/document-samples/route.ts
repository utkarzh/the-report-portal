import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { DOCUMENT_SAMPLES_BUCKET, MAX_SAMPLES, isDocType } from '@/lib/documents'
import { extractSampleText } from '@/lib/sample-extract'

async function requireAdmin() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

// GET /api/document-samples?docType=... — admin list (no extracted_text, to keep
// the payload small; the full text is only needed server-side at generate time).
export async function GET(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const docType = request.nextUrl.searchParams.get('docType')
  if (!isDocType(docType)) return NextResponse.json({ error: 'Invalid docType' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('document_samples')
    .select('id, doc_type, filename, mime, size_bytes, char_count, truncated, created_at')
    .eq('doc_type', docType)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ samples: data || [] })
}

// POST /api/document-samples — records a sample after the browser uploaded the
// file to the private bucket. Extracts its text server-side (so PDF works) and
// stores that alongside the storage path. Enforces the per-type cap.
export async function POST(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { docType, storagePath, filename, mime, sizeBytes } = await request.json()

  if (!isDocType(docType)) return NextResponse.json({ error: 'Invalid docType' }, { status: 400 })
  if (typeof storagePath !== 'string' || typeof filename !== 'string') {
    return NextResponse.json({ error: 'storagePath and filename are required' }, { status: 400 })
  }
  // The uploaded object must live in the admin's own folder (mirrors storage RLS).
  if (!storagePath.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 403 })
  }

  // Per-type cap.
  const { count } = await supabaseAdmin
    .from('document_samples')
    .select('id', { count: 'exact', head: true })
    .eq('doc_type', docType)
  if ((count ?? 0) >= MAX_SAMPLES) {
    return NextResponse.json({ error: `You can attach at most ${MAX_SAMPLES} sample documents per module.` }, { status: 409 })
  }

  // Download the uploaded object and extract its text.
  const { data: blob, error: dlError } = await supabaseAdmin
    .storage
    .from(DOCUMENT_SAMPLES_BUCKET)
    .download(storagePath)

  if (dlError || !blob) {
    return NextResponse.json({ error: 'Uploaded file not found in storage' }, { status: 400 })
  }

  let extracted
  try {
    const buffer = Buffer.from(await blob.arrayBuffer())
    extracted = await extractSampleText(filename, buffer)
  } catch (err) {
    // Extraction failed — clean up the orphaned object so a re-upload is clean.
    await supabaseAdmin.storage.from(DOCUMENT_SAMPLES_BUCKET).remove([storagePath])
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not read that document.' },
      { status: 400 },
    )
  }

  const { data: row, error: insertError } = await supabaseAdmin
    .from('document_samples')
    .insert({
      doc_type: docType,
      filename,
      storage_path: storagePath,
      mime: mime ?? null,
      size_bytes: typeof sizeBytes === 'number' ? sizeBytes : null,
      extracted_text: extracted.text,
      char_count: extracted.charCount,
      truncated: extracted.truncated,
      uploaded_by: user.id,
    })
    .select('id, doc_type, filename, mime, size_bytes, char_count, truncated, created_at')
    .single()

  if (insertError || !row) {
    await supabaseAdmin.storage.from(DOCUMENT_SAMPLES_BUCKET).remove([storagePath])
    return NextResponse.json({ error: 'Failed to save sample' }, { status: 500 })
  }

  return NextResponse.json({ sample: row }, { status: 201 })
}
