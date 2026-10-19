import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { extractSampleText } from '@/lib/sample-extract'
import { INTERVIEW_LETTER_SAMPLES_BUCKET, SAMPLE_LETTER_EXT_RE } from '@/lib/interview-letters'
import { SAMPLE_LIST_COLUMNS, cleanSampleMeta } from '@/lib/interview-letter-samples'

// A generous cap — sample letters are short, and only the top few relevant
// ones ever reach a prompt — just enough to stop an accidental bulk upload.
const MAX_LETTER_SAMPLES = 100

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

// POST — records a sample letter after the browser uploaded the file to the
// private bucket; extracts its text server-side (so PDF works). Mirrors
// /api/document-samples.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response
  const user = admin.user

  const body = await request.json().catch(() => ({}))
  const { storagePath, filename, mime, sizeBytes, title } = body

  if (typeof storagePath !== 'string' || typeof filename !== 'string' || !SAMPLE_LETTER_EXT_RE.test(filename)) {
    return NextResponse.json({ error: 'A .docx, .pdf, .txt or .md file is required' }, { status: 400 })
  }
  // The uploaded object must live in the admin's own folder (mirrors storage RLS).
  if (!storagePath.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 403 })
  }

  const { count } = await supabaseAdmin
    .from('interview_letter_samples')
    .select('id', { count: 'exact', head: true })
  if ((count ?? 0) >= MAX_LETTER_SAMPLES) {
    await supabaseAdmin.storage.from(INTERVIEW_LETTER_SAMPLES_BUCKET).remove([storagePath])
    return NextResponse.json({ error: `You can keep at most ${MAX_LETTER_SAMPLES} sample letters. Delete some first.` }, { status: 409 })
  }

  const { data: blob, error: dlError } = await supabaseAdmin.storage.from(INTERVIEW_LETTER_SAMPLES_BUCKET).download(storagePath)
  if (dlError || !blob) {
    return NextResponse.json({ error: 'Uploaded file not found in storage' }, { status: 400 })
  }

  let extracted
  try {
    extracted = await extractSampleText(filename, Buffer.from(await blob.arrayBuffer()))
  } catch (err) {
    await supabaseAdmin.storage.from(INTERVIEW_LETTER_SAMPLES_BUCKET).remove([storagePath])
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read that document.' }, { status: 400 })
  }

  const { data: row, error: insertError } = await supabaseAdmin
    .from('interview_letter_samples')
    .insert({
      ...cleanSampleMeta(body),
      title: (typeof title === 'string' && title.trim()) || filename.replace(/\.[^.]+$/, ''),
      filename,
      storage_path: storagePath,
      mime: mime ?? null,
      size_bytes: typeof sizeBytes === 'number' ? sizeBytes : null,
      extracted_text: extracted.text,
      char_count: extracted.charCount,
      truncated: extracted.truncated,
      uploaded_by: user.id,
    })
    .select(SAMPLE_LIST_COLUMNS)
    .single()

  if (insertError || !row) {
    await supabaseAdmin.storage.from(INTERVIEW_LETTER_SAMPLES_BUCKET).remove([storagePath])
    return NextResponse.json({ error: 'Failed to save sample' }, { status: 500 })
  }

  return NextResponse.json({ sample: row }, { status: 201 })
}
