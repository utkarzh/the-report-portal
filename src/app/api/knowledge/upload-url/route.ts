import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { canViewDepartment, getKbActor, requireGuardian } from '@/lib/knowledge/access'
import { KNOWLEDGE_BUCKET, MAX_UPLOAD_BYTES, UPLOAD_EXT_RE } from '@/lib/knowledge/constants'

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-120)
}

// POST /api/knowledge/upload-url — { departmentId, filename, size, purpose }
// Mints a one-off signed upload URL after checking the caller may upload
// there: the Guardian for knowledge files, any department member for a
// suggestion attachment. The browser then uploads straight to Storage, so
// large files never pass through a serverless request body.
export async function POST(request: NextRequest) {
  const { actor, response } = await getKbActor()
  if (!actor) return response

  const body = (await request.json().catch(() => ({}))) as {
    departmentId?: string
    filename?: string
    size?: number
    purpose?: 'item' | 'suggestion'
  }
  const filename = (body.filename || '').trim()
  if (!body.departmentId || !filename) return NextResponse.json({ error: 'departmentId and filename are required' }, { status: 400 })
  if (typeof body.size === 'number' && body.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 100 MB.' }, { status: 413 })
  }

  let folder: string
  if (body.purpose === 'suggestion') {
    if (!(await canViewDepartment(actor, body.departmentId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    folder = `${body.departmentId}/suggestions/${actor.id}`
  } else {
    if (!UPLOAD_EXT_RE.test(filename)) {
      return NextResponse.json({ error: `${filename}: upload a PDF, Word (.docx) or plain text file.` }, { status: 400 })
    }
    const g = await requireGuardian(actor, body.departmentId)
    if (!g.department) return g.response
    folder = `${body.departmentId}/items`
  }

  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(filename)}`
  const { data, error } = await supabaseAdmin.storage.from(KNOWLEDGE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: error?.message || 'Could not prepare the upload' }, { status: 500 })
  return NextResponse.json({ path: data.path, token: data.token })
}
