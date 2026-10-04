import { getSupabaseBrowserClient, ensureFreshSession } from '@/lib/supabase/client'

// A file the browser has already put in Supabase Storage. The upload routes
// receive only this (a few hundred bytes of JSON), never the file itself —
// so Vercel's ~4.5 MB request-body limit doesn't apply, same approach as the
// Transcriptions module's audio upload.
export interface StagedFile {
  path: string
  filename: string
  mime: string | null
  size: number
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
}

// Browser-side: uploads one file straight to `bucket` under `folder/`. The
// bucket's storage RLS decides who may write there (a user's own
// "<uid>/…" folder, or admins anywhere). Refreshes the session first so a
// long-open tab doesn't fail with an expired token.
export async function uploadToStorage(bucket: string, folder: string, file: File): Promise<StagedFile> {
  const supabase = getSupabaseBrowserClient()
  await ensureFreshSession(supabase)
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(file.name)}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (error) throw new Error(error.message || 'Upload failed')
  return { path, filename: file.name, mime: file.type || null, size: file.size }
}
