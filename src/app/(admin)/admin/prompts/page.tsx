export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import GeneralPromptForm from '@/components/admin/GeneralPromptForm'

export default async function PromptsPage() {
  requireAdminHeader()

  const { data } = await supabaseAdmin.from('general_prompt').select('*').single()

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-base font-semibold text-gray-900">General Prompt</h1>
        <p className="text-xs text-gray-500 mt-1 max-w-lg">
          This prompt applies to every research generation across all categories. It sets the overall tone, structure, and behaviour of the AI output.
        </p>
      </div>

      <div className="max-w-2xl">
        <GeneralPromptForm initialPrompt={data?.prompt_text || ''} />
      </div>
    </div>
  )
}
