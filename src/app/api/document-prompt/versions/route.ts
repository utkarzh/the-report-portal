import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isDocType } from '@/lib/documents'
import { getApiUser } from '@/lib/auth/api-user'

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const docType = request.nextUrl.searchParams.get('docType')
  if (!isDocType(docType)) {
    return NextResponse.json({ error: 'Invalid docType' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('document_prompt_versions')
    .select('id, prompt_text, saved_by, created_at, profiles:saved_by(email)')
    .eq('doc_type', docType)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const versions = (data || []).map((v: Record<string, unknown>) => ({
    id: v.id,
    prompt_text: v.prompt_text,
    saved_by: v.saved_by,
    saved_by_email: (v.profiles as { email?: string } | null)?.email ?? null,
    created_at: v.created_at,
  }))

  return NextResponse.json({ versions })
}
