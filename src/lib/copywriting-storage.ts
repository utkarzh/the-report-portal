import { supabaseAdmin } from '@/lib/supabase/admin'
import type { StagedFile } from '@/lib/copywriting-upload'

// Server-side counterpart of uploadToStorage(): validates the staged-file
// list a route received, and reads a staged file back from storage.

// Parses `{ files: StagedFile[] }`-style input. Every path must sit under
// `prefix` (the project/publication/article-type folder) so a caller can't
// point the route at someone else's object.
export function parseStagedFiles(raw: unknown, prefix: string): StagedFile[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: StagedFile[] = []
  for (const f of raw) {
    const r = f as Partial<StagedFile>
    if (typeof r?.path !== 'string' || typeof r?.filename !== 'string') return null
    if (!r.path.startsWith(prefix) || r.path.includes('..')) return null
    out.push({ path: r.path, filename: r.filename, mime: typeof r.mime === 'string' ? r.mime : null, size: Number(r.size) || 0 })
  }
  return out
}

export async function readStagedFile(bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(path)
  if (error || !data) throw new Error('Uploaded file not found in storage — please upload it again.')
  return Buffer.from(await data.arrayBuffer())
}

// Best-effort cleanup of staged files a route rejected or failed to process.
export async function removeStagedFiles(bucket: string, paths: string[]) {
  if (paths.length) await supabaseAdmin.storage.from(bucket).remove(paths)
}

// What the "View" button gets for any uploaded copywriting file: the text the
// AI reads (extracted at upload), plus a short-lived signed link to the
// original in its private bucket for "Open original".
export interface FileViewPayload {
  filename: string
  mime: string | null
  text: string
  charCount: number
  truncated: boolean
  url: string | null
}

export async function fileViewPayload(
  bucket: string,
  row: { filename: string; storage_path: string; extracted_text: string; char_count: number | null; truncated: boolean; mime?: string | null },
): Promise<FileViewPayload> {
  const { data } = await supabaseAdmin.storage.from(bucket).createSignedUrl(row.storage_path, 60 * 60)
  return {
    filename: row.filename,
    mime: row.mime ?? null,
    text: row.extracted_text || '',
    charCount: row.char_count ?? (row.extracted_text || '').length,
    truncated: row.truncated,
    url: data?.signedUrl ?? null,
  }
}
