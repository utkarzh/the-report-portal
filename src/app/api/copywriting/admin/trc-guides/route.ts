import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { extractSampleText } from '@/lib/sample-extract'
import { parseStagedFiles, readStagedFile, removeStagedFiles } from '@/lib/copywriting-storage'
import { TRC_GUIDES_BUCKET, MAX_TRC_GUIDES_PER_TYPE } from '@/lib/copywriting'

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return auth
}

// GET ?articleTypeId=... — the guide/example documents for one article type.
export async function GET(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response

  const articleTypeId = request.nextUrl.searchParams.get('articleTypeId')
  if (!articleTypeId) return NextResponse.json({ error: 'articleTypeId is required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('copywriting_trc_guides')
    .select('id, article_type_id, kind, filename, char_count, truncated, created_at')
    .eq('article_type_id', articleTypeId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ guides: data || [] })
}

// POST — multi-upload of TRC Guides or TRC Examples for one article type
// (both optional, independent of any publication).
export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  // The browser has already uploaded each file straight to the private TRC
  // guides bucket under "<article type id>/<kind>/" (uploadToStorage()); this
  // route only receives the paths — no file bytes, so no ~4.5 MB Vercel limit.
  const body = await request.json().catch(() => null)
  const articleTypeId = String(body?.articleTypeId || '')
  const kind = String(body?.kind || '')
  if (!articleTypeId) return NextResponse.json({ error: 'articleTypeId is required' }, { status: 400 })
  if (kind !== 'guide' && kind !== 'example') return NextResponse.json({ error: 'kind must be "guide" or "example"' }, { status: 400 })

  const files = parseStagedFiles(body?.files, `${articleTypeId}/${kind}/`)
  if (!files) return NextResponse.json({ error: 'No valid uploaded files provided' }, { status: 400 })
  const allPaths = files.map((f) => f.path)

  const { data: articleType } = await supabaseAdmin.from('copywriting_article_types').select('id').eq('id', articleTypeId).maybeSingle()
  if (!articleType) {
    await removeStagedFiles(TRC_GUIDES_BUCKET, allPaths)
    return NextResponse.json({ error: 'Article type not found' }, { status: 404 })
  }

  const { count } = await supabaseAdmin
    .from('copywriting_trc_guides')
    .select('id', { count: 'exact', head: true })
    .eq('article_type_id', articleTypeId)
    .eq('kind', kind)
  if ((count ?? 0) + files.length > MAX_TRC_GUIDES_PER_TYPE) {
    await removeStagedFiles(TRC_GUIDES_BUCKET, allPaths)
    return NextResponse.json({ error: `At most ${MAX_TRC_GUIDES_PER_TYPE} ${kind} files per article type.` }, { status: 409 })
  }

  const uploaded: unknown[] = []
  const errors: { filename: string; error: string }[] = []

  for (const file of files) {
    try {
      const buffer = await readStagedFile(TRC_GUIDES_BUCKET, file.path)
      const extracted = await extractSampleText(file.filename, buffer, { maxChars: null })

      const { data: row, error: insertErr } = await supabaseAdmin
        .from('copywriting_trc_guides')
        .insert({
          article_type_id: articleTypeId,
          kind,
          filename: file.filename,
          storage_path: file.path,
          extracted_text: extracted.text,
          char_count: extracted.charCount,
          truncated: extracted.truncated,
          created_by: admin.user.id,
        })
        .select('id, article_type_id, kind, filename, char_count, truncated, created_at')
        .single()
      if (insertErr || !row) throw new Error(insertErr?.message || 'Failed to save file')
      uploaded.push(row)
    } catch (err) {
      await removeStagedFiles(TRC_GUIDES_BUCKET, [file.path])
      errors.push({ filename: file.filename, error: err instanceof Error ? err.message : 'Upload failed' })
    }
  }

  return NextResponse.json({ uploaded, errors }, { status: uploaded.length ? 201 : 400 })
}
