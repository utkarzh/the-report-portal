import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { denyWithoutCopywritingAccess } from '@/lib/copywriting-access'
import { COPYWRITING_IMAGES_BUCKET, COPYWRITING_IMAGE_EXT_RE, MAX_IMAGE_BYTES, maxUploadableSlot } from '@/lib/copywriting'
import { loadProjectImages } from '@/lib/copywriting-images'
import { parseStagedFiles, readStagedFile, removeStagedFiles } from '@/lib/copywriting-storage'

interface Params {
  params: { id: string }
}

async function loadOwnedProject(id: string, userId: string) {
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  const { data: project } = await supabaseAdmin
    .from('copywriting_projects')
    .select('id, user_id, stage, image_count')
    .eq('id', id)
    .maybeSingle()
  if (!project) return { project: null, ok: false }
  return { project, ok: project.user_id === userId || profile?.role === 'admin' }
}

// Slots are fillable from the first draft onward: up to the configured count,
// or any slot the draft has when the AI chose the count (image_count blank).
function slotError(project: { stage: string; image_count: number | null }, slot: number): string | null {
  const max = maxUploadableSlot(project.image_count)
  if (max < 1) return 'This article is set to have no images.'
  if (!Number.isInteger(slot) || slot < 1 || slot > max) return `Image slot must be between 1 and ${max}.`
  if (project.stage !== 'draft_review' && project.stage !== 'complete') return 'Images can be added once the first draft exists.'
  return null
}

// POST { slot, path, filename, mime, size, width?, height? } — puts a photo into one
// numbered [IMAGE n: …] slot, replacing whatever was there.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied

  const { project, ok } = await loadOwnedProject(params.id, auth.user.id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // The browser has already uploaded the photo straight to the private
  // copywriting-images bucket under "<owner uid>/<project id>/"
  // (uploadToStorage()); this route only gets its path — no file bytes, so
  // Vercel's ~4.5 MB body limit doesn't apply.
  const body = await request.json().catch(() => null)
  const slot = Number(body?.slot)
  const staged = parseStagedFiles(body?.path ? [{ path: body.path, filename: body.filename, mime: body.mime, size: body.size }] : null, `${project.user_id}/${project.id}/`)
  if (!staged) return NextResponse.json({ error: 'No valid uploaded image provided' }, { status: 400 })
  const file = staged[0]
  const reject = async (error: string, status: number) => {
    await removeStagedFiles(COPYWRITING_IMAGES_BUCKET, [file.path])
    return NextResponse.json({ error }, { status })
  }
  const err = slotError(project, slot)
  if (err) return reject(err, 409)
  if (!COPYWRITING_IMAGE_EXT_RE.test(file.filename)) return reject('Use a JPG or PNG image (WebP is converted to JPG in the browser).', 400)

  // Confirm the object really exists (and get its true size) before recording it.
  let sizeBytes: number
  try {
    sizeBytes = (await readStagedFile(COPYWRITING_IMAGES_BUCKET, file.path)).length
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Upload not found' }, { status: 400 })
  }
  if (sizeBytes > MAX_IMAGE_BYTES) return reject('Images must be 15 MB or smaller.', 400)

  const width = Number(body?.width) || null
  const height = Number(body?.height) || null
  const storagePath = file.path

  const { data: previous } = await supabaseAdmin
    .from('copywriting_project_images')
    .select('storage_path')
    .eq('project_id', project.id)
    .eq('slot', slot)
    .maybeSingle()

  const { error: dbErr } = await supabaseAdmin.from('copywriting_project_images').upsert(
    {
      project_id: project.id,
      user_id: auth.user.id,
      slot,
      filename: file.filename,
      storage_path: storagePath,
      mime: file.mime,
      size_bytes: sizeBytes,
      width,
      height,
    },
    { onConflict: 'project_id,slot' },
  )
  if (dbErr) {
    await supabaseAdmin.storage.from(COPYWRITING_IMAGES_BUCKET).remove([storagePath])
    return NextResponse.json({ error: dbErr.message }, { status: 500 })
  }
  if (previous?.storage_path) await supabaseAdmin.storage.from(COPYWRITING_IMAGES_BUCKET).remove([previous.storage_path])

  await supabaseAdmin.from('copywriting_project_events').insert({
    project_id: project.id,
    event_type: 'image_added',
    summary: `${previous ? 'Replaced' : 'Added'} the photo for image ${slot} (${file.filename}).`,
  })

  return NextResponse.json({ images: await loadProjectImages(project.id) }, { status: 201 })
}

// DELETE ?slot=n — empties one slot.
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied

  const { project, ok } = await loadOwnedProject(params.id, auth.user.id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const slot = Number(request.nextUrl.searchParams.get('slot'))
  const err = slotError(project, slot)
  if (err) return NextResponse.json({ error: err }, { status: 409 })

  const { data: row } = await supabaseAdmin
    .from('copywriting_project_images')
    .select('id, storage_path')
    .eq('project_id', project.id)
    .eq('slot', slot)
    .maybeSingle()
  if (!row) return NextResponse.json({ images: await loadProjectImages(project.id) })

  await supabaseAdmin.storage.from(COPYWRITING_IMAGES_BUCKET).remove([row.storage_path])
  await supabaseAdmin.from('copywriting_project_images').delete().eq('id', row.id)
  await supabaseAdmin.from('copywriting_project_events').insert({
    project_id: project.id,
    event_type: 'image_removed',
    summary: `Removed the photo from image ${slot}.`,
  })

  return NextResponse.json({ images: await loadProjectImages(project.id) })
}
