export const dynamic = 'force-dynamic'

import { redirect, notFound } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import AdminPromptEditor from '@/components/copywriting/AdminPromptEditor'
import { COPYWRITING_PROMPT_KEYS, INITIAL_PROMPT_VERSION, isCopywritingPromptKey } from '@/lib/copywriting'

export default async function CopywritingPromptEditPage({ params }: { params: { key: string } }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/copywriting')
  if (!isCopywritingPromptKey(params.key)) notFound()

  const meta = COPYWRITING_PROMPT_KEYS.find((p) => p.key === params.key)!
  const supabase = createSupabaseServerClient()
  const { data } = await supabase.from('copywriting_prompt').select('prompt_text, prompt_version').eq('prompt_key', params.key).maybeSingle()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-4xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Copywriting Tool', href: '/copywriting' },
            { label: 'Admin', href: '/copywriting/admin' },
            { label: 'Stage Prompts', href: '/copywriting/admin/prompts' },
            { label: meta.label },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">{meta.label}</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">{meta.description}</p>
        </div>

        <AdminPromptEditor promptKey={params.key} label={meta.label} initialText={data?.prompt_text || ''} initialVersion={data?.prompt_version || INITIAL_PROMPT_VERSION} />
      </div>
    </div>
  )
}
