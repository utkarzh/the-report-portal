import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import ResearchForm from '@/components/research/ResearchForm'
import type { Category } from '@/types'

export default async function ResearchPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, description')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const isAtLimit = profile.role === 'user' && profile.tokens_used >= profile.token_limit

  return (
    <div className="flex h-full">
      {/* Left panel — output area */}
      <div className="flex-1 flex flex-col">
        <div className="p-6 border-b border-[#e5e3df] bg-[#f0efec]">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">
            Interview Research &amp; Questions
          </h3>
          <p className="text-xs text-gray-500 flex items-center gap-1.5">
            <span className="text-gray-300">✦</span>
            Fill in the interviewee details on the right and click{' '}
            <strong className="font-semibold text-gray-700">Start Research</strong> — Claude
            generates structured research then 10 questions, and you refine through chat.
          </p>
        </div>
        <div className="flex-1 bg-[#f0efec]" />
      </div>

      {/* Right panel — form */}
      <div className="w-80 bg-white border-l border-[#e5e3df] flex flex-col flex-shrink-0 overflow-y-auto">
        <div className="p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">New Interview</h2>
          <p className="text-xs text-gray-500 mb-6">
            Fill in the details below. Claude will research the interviewee and generate interview questions.
          </p>

          {isAtLimit ? (
            <div className="p-4 bg-red-50 border border-red-200">
              <p className="text-xs font-medium text-red-700 mb-1">Token limit reached</p>
              <p className="text-xs text-red-600">
                You have used your monthly token limit. Please contact an administrator to increase your limit.
              </p>
            </div>
          ) : (
            <ResearchForm
              categories={(categories || []) as Category[]}
              isAtLimit={isAtLimit}
            />
          )}
        </div>
      </div>
    </div>
  )
}
