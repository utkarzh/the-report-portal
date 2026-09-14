import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { getApiUser } from '@/lib/auth/api-user'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isSalesCoachKnowledgeKey } from '@/lib/sales-coach'

interface Params {
  params: { docKey: string }
}

// Resolves the caller and requires the admin role. A transient sign-in-service
// failure comes back as a retryable 503 (see getApiUser), never as Forbidden.
async function requireAdmin(): Promise<{ user: User; response?: undefined } | { user: null; response: NextResponse }> {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user: auth.user }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.user) return auth.response
  const user = auth.user

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
