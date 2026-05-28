import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import ResearchForm from '@/components/research/ResearchForm'
import { Sparkles, ClipboardList, MessageSquare, ArrowRight } from 'lucide-react'
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
    <div className="flex flex-col lg:flex-row h-full min-h-0">

      {/* Form — full width on mobile, fixed left panel on desktop */}
      <div className="w-full lg:w-80 bg-white border-b lg:border-b-0 lg:border-r border-[#e5e3df] flex-shrink-0 overflow-y-auto order-1">
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

      {/* Empty state — shows below form on mobile, fills right on desktop */}
      <div className="flex-1 flex flex-col items-center justify-center bg-[#f0efec] p-8 order-2 min-h-[280px]">
        <div className="w-full max-w-sm">

          <div className="w-11 h-11 rounded-full bg-white border border-[#e5e3df] flex items-center justify-center mb-5 shadow-sm">
            <Sparkles size={18} className="text-gray-400" />
          </div>

          <h2 className="text-base font-semibold text-gray-900 mb-2">
            Interview Research &amp; Questions
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed mb-8">
            Fill in the interviewee details, click <strong className="font-semibold text-gray-700">Start Research</strong> and Claude
            will generate structured background research followed by tailored interview questions.
          </p>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-0">
            <Step icon={<ClipboardList size={14} />} label="Fill in details" sub="Name, role, category" />
            <ChevronSep />
            <Step icon={<Sparkles size={14} />} label="Generate" sub="Claude researches & drafts" />
            <ChevronSep />
            <Step icon={<MessageSquare size={14} />} label="Refine" sub="Chat to perfect questions" />
          </div>
        </div>
      </div>


    </div>
  )
}

function Step({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-2.5 flex-1">
      <div className="w-7 h-7 rounded-full bg-white border border-[#e5e3df] flex items-center justify-center flex-shrink-0 text-gray-400 shadow-sm">
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium text-gray-700">{label}</p>
        <p className="text-[11px] text-gray-400 leading-tight mt-0.5">{sub}</p>
      </div>
    </div>
  )
}

function ChevronSep() {
  return (
    <div className="hidden sm:flex items-center px-2 text-gray-300 flex-shrink-0">
      <ArrowRight size={13} />
    </div>
  )
}
