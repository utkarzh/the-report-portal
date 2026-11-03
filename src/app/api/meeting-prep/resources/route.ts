import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import {
  MEETING_PREP_RESOURCE_SLOTS, MEETING_PREP_SAMPLE_AUDIO_BUCKET, isResourceSlot, type MeetingPrepResourceSlot,
} from '@/lib/meeting-prep'
import { getResourceFile, resourceFolder } from '@/lib/meeting-prep-server'

const BUCKET = MEETING_PREP_SAMPLE_AUDIO_BUCKET
const MAX_BYTES = 50 * 1024 * 1024

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

// Deletes every file in a slot's folder except `keep`.
async function removeOthers(slot: MeetingPrepResourceSlot, keep: string | null) {
  const folder = resourceFolder(slot)
  const { data } = await supabaseAdmin.storage.from(BUCKET).list(folder, { limit: 100 })
  const paths = (data || []).filter((f) => f.id).map((f) => `${folder}/${f.name}`).filter((p) => p !== keep)
  if (paths.length) await supabaseAdmin.storage.from(BUCKET).remove(paths)
}

// GET — admin: what each slot holds.
export async function GET() {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response
  const files = await Promise.all(MEETING_PREP_RESOURCE_SLOTS.map((s) => getResourceFile(s.slot)))
  return NextResponse.json({
    slots: MEETING_PREP_RESOURCE_SLOTS.map((s, i) => ({ slot: s.slot, file: files[i] })),
  })
}

// POST { slot, storagePath } — admin: the browser has uploaded a new file
// to resources/<slot>/; it replaces whatever the slot held, and the old
// file is deleted from storage.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const { slot, storagePath } = await request.json().catch(() => ({}))
  if (!isResourceSlot(slot) || typeof storagePath !== 'string') {
    return NextResponse.json({ error: 'slot and storagePath are required' }, { status: 400 })
  }
  const folder = resourceFolder(slot)
  if (!storagePath.startsWith(`${folder}/`) || storagePath.slice(folder.length + 1).includes('/')) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
  }

  const { data: listed } = await supabaseAdmin.storage.from(BUCKET).list(folder, { limit: 100 })
  const uploaded = (listed || []).find((f) => `${folder}/${f.name}` === storagePath)
  if (!uploaded) return NextResponse.json({ error: 'Uploaded file not found in storage' }, { status: 400 })
  const size = (uploaded.metadata as { size?: number } | null)?.size ?? 0
  if (size > MAX_BYTES) {
    await supabaseAdmin.storage.from(BUCKET).remove([storagePath])
    return NextResponse.json({ error: 'That file is larger than 50 MB.' }, { status: 400 })
  }

  await removeOthers(slot, storagePath)
  return NextResponse.json({ file: await getResourceFile(slot) })
}

// DELETE ?slot= — admin: empties the slot (and deletes its file).
export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response
  const slot = request.nextUrl.searchParams.get('slot')
  if (!isResourceSlot(slot)) return NextResponse.json({ error: 'Invalid slot' }, { status: 400 })
  await removeOthers(slot, null)
  return NextResponse.json({ success: true })
}
