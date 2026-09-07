import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isSalesCoachKnowledgeKey } from '@/lib/sales-coach'

interface Params {
  params: { docKey: string }
}

async function requireAdmin() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!isSalesCoachKnowledgeKey(params.docKey)) {
    return NextResponse.json({ error: 'Invalid document' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('sales_coach_knowledge_versions')
    .select('id, content, saved_by, created_at, profiles:saved_by(email)')
    .eq('doc_key', params.docKey)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Expose `content` as `prompt_text` — the shape PromptVersionHistory renders.
  const versions = (data || []).map((v: Record<string, unknown>) => ({
    id: v.id,
    prompt_text: v.content,
    saved_by: v.saved_by,
    saved_by_email: (v.profiles as { email?: string } | null)?.email ?? null,
    created_at: v.created_at,
  }))

  return NextResponse.json({ versions })
}
