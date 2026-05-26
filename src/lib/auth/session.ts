import { cache } from 'react'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Profile, UserRole } from '@/types'

export const getServerUser = cache(async () => {
  const supabase = createSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
})

export const getServerProfile = cache(async (): Promise<Profile | null> => {
  const user = await getServerUser()
  if (!user) return null

  const supabase = createSupabaseServerClient()
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return data as Profile | null
})

export async function requireAdmin(): Promise<Profile> {
  const profile = await getServerProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')
  return profile
}

// Reads the middleware-injected profile from request headers.
// Zero Supabase calls — middleware already validated and set these.
export function getProfileFromHeaders() {
  const h = headers()
  const role = h.get('x-user-role') as UserRole | null
  if (!role) return null
  return {
    id: h.get('x-user-id') ?? '',
    full_name: h.get('x-user-name') || null,
    role,
    status: 'active' as const,
    tokens_used: Number(h.get('x-user-tokens-used') ?? '0'),
    token_limit: Number(h.get('x-user-token-limit') ?? '0'),
  }
}

// Synchronous admin guard using the middleware-injected role header.
// Throws a redirect if the user isn't an admin — no DB call needed.
export function requireAdminHeader(): void {
  const h = headers()
  const role = h.get('x-user-role')
  if (!role) redirect('/login')
  if (role !== 'admin') redirect('/dashboard')
}
