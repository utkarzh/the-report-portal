import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getDocConfig, isDocType } from '@/lib/documents'
import { buildDocumentDocx } from '@/lib/docx-template'
import { getApiUser } from '@/lib/auth/api-user'

// GET /api/documents/[id]/download
// Serves a document session's output as a real Word (.docx) file styled to the
// house Business-Case / Editorial-Brief template (see src/lib/docx-template.ts).
// Owner or admin only.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: session } = await supabaseAdmin
    .from('document_sessions')
    .select('id, user_id, doc_type, title, project_country, media_partner, media_country, output, created_at')
    .eq('id', params.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!session.output) {
    return NextResponse.json({ error: 'Output not available' }, { status: 404 })
  }
  if (!isDocType(session.doc_type)) {
    return NextResponse.json({ error: 'Invalid document type' }, { status: 400 })
  }

  const config = getDocConfig(session.doc_type)
  const doc = buildDocumentDocx(session.output, config, {
    title: session.title,
    project_country: session.project_country,
    media_partner: session.media_partner,
    media_country: session.media_country,
    created_at: session.created_at,
  })

  const buffer = await Packer.toBuffer(doc)
  const base =
    (session.title || config.label).replace(/[^a-z0-9-_ ]/gi, '').trim() || 'document'
  const filename = `${base}.docx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
