export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import TranscriptPromptForm from '@/components/admin/TranscriptPromptForm'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

export default async function TranscriptPromptPage() {
  requireAdminHeader()

  // NOTE: `transcript_prompt` table is added in a later migration. Until then this
  // returns no row and the form starts empty — safe, the query does not throw.
  const { data } = await supabaseAdmin.from('transcript_prompt').select('*').single()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Transcriptions', href: '/transcriptions' },
            { label: 'Refining Prompt' },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Refining Prompt</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            This prompt is applied when refining a transcript with AI. It sets the tone, structure, and editorial style the AI should follow when polishing every transcription.
          </p>
        </div>

        <TranscriptPromptForm initialPrompt={data?.prompt_text || ''} />
      </div>
    </div>
  )
}
