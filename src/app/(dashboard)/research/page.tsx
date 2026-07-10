import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import ResearchForm from '@/components/research/ResearchForm'
import { Sparkles, ClipboardList, MessageSquare, Info } from 'lucide-react'
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
            Fill in the details below. The AI will research the interviewee and generate interview questions.
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
      <div className="flex-1 flex flex-col items-center justify-center overflow-hidden bg-[#f0efec] p-8 order-2 min-h-[320px]">
        <div className="w-full max-w-md text-center">

          {/* Gemini-style glowing emblem — a rotating monochrome aurora +
              breathing bloom behind the Sparkles mark. Black & white only. */}
          <div className="fade-up relative mx-auto mb-7 flex h-24 w-24 items-center justify-center">
            {/* rotating aurora glow */}
            <div className="gemini-aurora absolute -inset-1 rounded-full opacity-70 blur-xl" />
            {/* breathing bloom */}
            <div className="gemini-bloom absolute inset-1 rounded-full blur-2xl" />
            {/* core mark */}
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 shadow-xl ring-1 ring-white/10">
              <Sparkles size={24} className="gemini-sparkle text-white" />
            </div>
          </div>

          <h2 className="fade-up text-lg font-semibold text-gray-900 mb-2" style={{ animationDelay: '0.05s' }}>
            Interview Research &amp; Questions
          </h2>
          <p className="fade-up mx-auto max-w-sm text-xs text-gray-500 leading-relaxed mb-8" style={{ animationDelay: '0.12s' }}>
            Fill in the interviewee details, click <strong className="font-semibold text-gray-700">Start Research</strong> and the AI
            will generate structured background research followed by tailored interview questions.
          </p>

          {/* Flowing three-step pipeline */}
          <div className="fade-up flex items-start justify-between gap-1" style={{ animationDelay: '0.2s' }}>
            <Step icon={<ClipboardList size={15} />} label="Fill in details" sub="Name, role, category" />
            <FlowLine />
            <Step icon={<Sparkles size={15} />} label="Generate" sub="AI researches &amp; drafts" />
            <FlowLine />
            <Step icon={<MessageSquare size={15} />} label="Refine" sub="Perfect the questions" />
          </div>

          <div className="fade-up mt-9 flex items-start gap-2.5 rounded-xl border border-[#e5e3df] bg-white/70 px-4 py-3 text-left shadow-sm backdrop-blur-sm" style={{ animationDelay: '0.28s' }}>
            <Info size={15} className="mt-0.5 flex-shrink-0 text-[#c8973f]" />
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Research and question drafting is done using various AI models, which
              might produce some inaccuracies from time to time. Please review and
              verify the output before using it in your work.
            </p>
          </div>
        </div>
      </div>


    </div>
  )
}

function Step({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="flex w-20 flex-shrink-0 flex-col items-center gap-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e5e3df] bg-white text-gray-500 shadow-sm">
        {icon}
      </div>
      <div>
        <p className="text-[11px] font-semibold text-gray-700 leading-tight">{label}</p>
        <p className="mt-0.5 text-[10px] text-gray-400 leading-tight">{sub}</p>
      </div>
    </div>
  )
}

function FlowLine() {
  return <div className="flow-line mt-4 h-0.5 flex-1 rounded-full" />
}
