export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isMeetingPrepPromptKey, MEETING_PREP_PROMPT_KEYS } from '@/lib/meeting-prep'
import MeetingPrepPromptForm from '@/components/admin/MeetingPrepPromptForm'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

interface Props {
  params: { promptKey: string }
}

export default async function MeetingPrepPromptPage({ params }: Props) {
  requireAdminHeader()

  if (!isMeetingPrepPromptKey(params.promptKey)) notFound()
  const promptKey = params.promptKey
  const meta = MEETING_PREP_PROMPT_KEYS.find(p => p.key === promptKey)
  const label = meta?.label ?? promptKey

  const { data: row } = await supabaseAdmin
    .from('meeting_prep_prompt')
    .select('prompt_text')
    .eq('prompt_key', promptKey)
    .maybeSingle()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Meeting Preparation', href: '/meeting-preparation' },
            { label: 'Admin', href: '/admin/meeting-prep' },
            { label: `${label} Prompt` },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">{label} Prompt</h1>
          {meta?.description && (
            <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">{meta.description}</p>
          )}
        </div>

        <MeetingPrepPromptForm
          promptKey={promptKey}
          label={label}
          initialPrompt={row?.prompt_text || ''}
        />
      </div>
    </div>
  )
}
