import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { extractSampleText } from '@/lib/sample-extract'
import { parseStagedFiles, readStagedFile, removeStagedFiles } from '@/lib/copywriting-storage'
import { PUBLICATION_GUIDES_BUCKET, MAX_PUBLICATION_GUIDES } from '@/lib/copywriting'

interface Params {
  params: { id: string }
}

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return auth
}

// POST { files: StagedFile[] } — a publication's style guide(s), pdf/docx (Optional
// per the brief — a publication can have zero or more).
export async function POST(request: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const { data: publication } = await supabaseAdmin.from('copywriting_publications').select('id').eq('id', params.id).maybeSingle()
  if (!publication) return NextResponse.json({ error: 'Publication not found' }, { status: 404 })

  // The browser has already uploaded each file straight to the private
  // guides bucket under "<publication id>/" (uploadToStorage()); this route
  // only receives the paths — no file bytes, so no ~4.5 MB Vercel limit.
  const body = await request.json().catch(() => null)
  const files = parseStagedFiles(body?.files, `${params.id}/`)
  if (!files) return NextResponse.json({ error: 'No valid uploaded files provided' }, { status: 400 })

  const { count } = await supabaseAdmin
    .from('copywriting_publication_guides')
    .select('id', { count: 'exact', head: true })
    .eq('publication_id', params.id)
  if ((count ?? 0) + files.length > MAX_PUBLICATION_GUIDES) {
    await removeStagedFiles(PUBLICATION_GUIDES_BUCKET, files.map((f) => f.path))
    return NextResponse.json({ error: `A publication can have at most ${MAX_PUBLICATION_GUIDES} guide files.` }, { status: 409 })
  }

  const uploaded: unknown[] = []
  const errors: { filename: string; error: string }[] = []

  for (const file of files) {
    try {
      if (!/\.(pdf|docx)$/i.test(file.filename)) throw new Error('Only .pdf and .docx are accepted')
      const buffer = await readStagedFile(PUBLICATION_GUIDES_BUCKET, file.path)
      const extracted = await extractSampleText(file.filename, buffer, { maxChars: null })

      const { data: row, error: insertErr } = await supabaseAdmin
        .from('copywriting_publication_guides')
        .insert({
          publication_id: params.id,
          filename: file.filename,
          storage_path: file.path,
          extracted_text: extracted.text,
          char_count: extracted.charCount,
          truncated: extracted.truncated,
          created_by: admin.user.id,
        })
        .select('id, filename, char_count, truncated, created_at')
        .single()
      if (insertErr || !row) throw new Error(insertErr?.message || 'Failed to save guide')
      uploaded.push(row)
    } catch (err) {
      await removeStagedFiles(PUBLICATION_GUIDES_BUCKET, [file.path])
      errors.push({ filename: file.filename, error: err instanceof Error ? err.message : 'Upload failed' })
    }
  }

  return NextResponse.json({ uploaded, errors }, { status: uploaded.length ? 201 : 400 })
}
