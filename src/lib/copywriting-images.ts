import { supabaseAdmin } from '@/lib/supabase/admin'
import { COPYWRITING_IMAGES_BUCKET, maxUploadableSlot } from '@/lib/copywriting'
import type { CopywritingProjectImage } from '@/types'

// Signed-URL lifetime for image previews. Long enough for a working session;
// the workspace re-fetches the project (and so fresh URLs) after every action.
const SIGNED_URL_TTL_S = 60 * 60

// A project's filled image slots, each with a short-lived signed URL (the
// bucket is private). Server-only — uses the service role, so callers must
// have already checked the viewer owns the project or is an admin.
export async function loadProjectImages(projectId: string): Promise<CopywritingProjectImage[]> {
  const { data: rows } = await supabaseAdmin
    .from('copywriting_project_images')
    .select('*')
    .eq('project_id', projectId)
    .order('slot')
  if (!rows?.length) return []

  const { data: signed } = await supabaseAdmin.storage
    .from(COPYWRITING_IMAGES_BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_TTL_S)
  const urlByPath = new Map((signed || []).map((s) => [s.path, s.signedUrl]))
  return rows.map((r) => ({ ...r, url: urlByPath.get(r.storage_path) ?? null }))
}

// ── Photos for the Word / PDF exports ────────────────────────────────────
export interface ExportImage {
  data: Buffer
  type: 'jpg' | 'png'
  width: number
  height: number
}

// Pixel size from the file header, for photos saved without width/height.
// PNG: IHDR at byte 16. JPEG: walk segments to the first SOFn marker.
export function readImageSize(buf: Buffer, type: 'jpg' | 'png'): { width: number; height: number } | null {
  try {
    if (type === 'png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    let i = 2
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  } catch {
    // fall through
  }
  return null
}

// Every filled slot's photo bytes, keyed by slot number. Server-only (service
// role) — the export route checks ownership first. A photo that can't be
// downloaded or isn't JPG/PNG is skipped, so the export shows its caption
// placeholder instead of failing.
export async function loadExportImages(projectId: string): Promise<Map<number, ExportImage>> {
  const out = new Map<number, ExportImage>()
  const { data: rows } = await supabaseAdmin.from('copywriting_project_images').select('*').eq('project_id', projectId)
  await Promise.all(
    (rows || []).map(async (r) => {
      const name = `${r.storage_path} ${r.mime || ''}`.toLowerCase()
      const type: 'jpg' | 'png' | null = /png/.test(name) ? 'png' : /jpe?g/.test(name) ? 'jpg' : null
      if (!type) return
      const { data: blob } = await supabaseAdmin.storage.from(COPYWRITING_IMAGES_BUCKET).download(r.storage_path)
      if (!blob) return
      const data = Buffer.from(await blob.arrayBuffer())
      const size = r.width && r.height ? { width: r.width, height: r.height } : readImageSize(data, type)
      out.set(r.slot, { data, type, width: size?.width || 1200, height: size?.height || 800 })
    }),
  )
  return out
}

// Scales a photo to fit within a box, keeping its aspect ratio.
export function fitImage(img: { width: number; height: number }, maxW: number, maxH: number) {
  const scale = Math.min(maxW / img.width, maxH / img.height, 1)
  return { width: Math.round(img.width * scale), height: Math.round(img.height * scale) }
}

// ── Filling a slot (shared by the upload route and "Use this photo") ─────

// Slots are fillable from the first draft onward: up to the configured count,
// or any slot the draft has when the AI chose the count (image_count blank).
export function imageSlotError(project: { stage: string; image_count: number | null }, slot: number): string | null {
  const max = maxUploadableSlot(project.image_count)
  if (max < 1) return 'This article is set to have no images.'
  if (!Number.isInteger(slot) || slot < 1 || slot > max) return `Image slot must be between 1 and ${max}.`
  if (project.stage !== 'draft_review' && project.stage !== 'complete') return 'Images can be added once the first draft exists.'
  return null
}

// Records a stored photo as the slot's image, replacing (and deleting) any
// photo already there, and logs it on the project's history. On a database
// error the new file is removed and the error returned.
export async function saveSlotImage(opts: {
  projectId: string
  userId: string
  slot: number
  filename: string
  storagePath: string
  mime: string | null
  sizeBytes: number
  width: number | null
  height: number | null
  /** How it got there, for the history line, e.g. "free image from Wikimedia Commons". */
  via?: string
}): Promise<{ error: string | null }> {
  const { data: previous } = await supabaseAdmin
    .from('copywriting_project_images')
    .select('storage_path')
    .eq('project_id', opts.projectId)
    .eq('slot', opts.slot)
    .maybeSingle()

  const { error } = await supabaseAdmin.from('copywriting_project_images').upsert(
    {
      project_id: opts.projectId,
      user_id: opts.userId,
      slot: opts.slot,
      filename: opts.filename,
      storage_path: opts.storagePath,
      mime: opts.mime,
      size_bytes: opts.sizeBytes,
      width: opts.width,
      height: opts.height,
    },
    { onConflict: 'project_id,slot' },
  )
  if (error) {
    await supabaseAdmin.storage.from(COPYWRITING_IMAGES_BUCKET).remove([opts.storagePath])
    return { error: error.message }
  }
  if (previous?.storage_path && previous.storage_path !== opts.storagePath) {
    await supabaseAdmin.storage.from(COPYWRITING_IMAGES_BUCKET).remove([previous.storage_path])
  }

  await supabaseAdmin.from('copywriting_project_events').insert({
    project_id: opts.projectId,
    event_type: 'image_added',
    summary: `${previous ? 'Replaced' : 'Added'} the photo for image ${opts.slot} (${opts.filename}${opts.via ? `, ${opts.via}` : ''}).`,
  })
  return { error: null }
}
