import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/auth/api-user'

interface Params {
  params: { id: string }
}

// GET — list personalized outputs for a project. RLS (owner or admin, via the
// parent project) applies since this uses the cookie-scoped client.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const auth = await getApiUser()
  if (!auth.user) return auth.response

  const { data, error } = await supabase
    .from('interview_letter_personalizations')
    .select('*')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ personalizations: data || [] })
}
