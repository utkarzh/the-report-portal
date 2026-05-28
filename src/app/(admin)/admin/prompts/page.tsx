export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import GeneralPromptForm from '@/components/admin/GeneralPromptForm'

export default async function PromptsPage() {
  requireAdminHeader()

  const { data } = await supabaseAdmin.from('general_prompt').select('*').single()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">General Prompt</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            This prompt applies to every research generation across all categories. It sets the overall tone, structure, and behaviour of the AI output.
          </p>
        </div>

        <GeneralPromptForm initialPrompt={data?.prompt_text || ''} />
      </div>
    </div>
  )
}
