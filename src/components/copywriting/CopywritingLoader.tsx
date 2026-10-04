'use client'

import { useEffect, useState } from 'react'
import { FileSearch, ListTree, PenLine, RefreshCw, Search, Sparkles, ClipboardCheck, type LucideIcon } from 'lucide-react'

// Animated "AI is working" state for every Copywriting Tool AI step — same
// visual language as DocumentGeneratingLoader (glowing emblem, flowing line,
// rotating status hints, live elapsed clock) instead of a bare spinner or a
// "Loading..." button. `compact` is the inline strip used inside a card
// (regenerate a section, replan, research, chat reply, checks).

export type CopywritingLoaderVariant = 'analyze' | 'regenerate' | 'plan' | 'replan' | 'draft' | 'research' | 'revise' | 'check'

const CONFIG: Record<CopywritingLoaderVariant, { title: string; icon: LucideIcon; estimate: string; hints: string[] }> = {
  analyze: {
    title: 'Analyzing your sources',
    icon: FileSearch,
    estimate: 'usually under a minute',
    hints: [
      'Reading every uploaded source…',
      'Learning the publication’s style and rules…',
      'Pulling out quotable lines…',
      'Listing the facts the sources support…',
      'Spotting information gaps…',
      'Organising everything into sections…',
    ],
  },
  regenerate: {
    title: 'Regenerating this section',
    icon: RefreshCw,
    estimate: 'usually 20–40 seconds',
    hints: ['Re-reading the sources…', 'Applying your feedback…', 'Rewriting the section…', 'Checking it against the rest of the analysis…'],
  },
  plan: {
    title: 'Planning the article',
    icon: ListTree,
    estimate: 'usually under a minute',
    hints: [
      'Reviewing the approved analysis…',
      'Finding the thesis…',
      'Shaping the section structure…',
      'Placing quotes and research…',
      'Splitting the target length across sections…',
    ],
  },
  replan: {
    title: 'Revising the plan',
    icon: ListTree,
    estimate: 'usually under a minute',
    hints: ['Reading your requested changes…', 'Reworking the structure…', 'Keeping it grounded in the approved material…', 'Tidying the paragraph plan…'],
  },
  draft: {
    title: 'Writing the first draft',
    icon: PenLine,
    estimate: 'a full draft can take a minute or two',
    hints: [
      'Following the approved plan…',
      'Writing the opening…',
      'Weaving in the quotes, exactly as sourced…',
      'Applying the publication and TRC rules…',
      'Building out each section…',
      'Flagging any information gaps for research…',
      'Running the automated checks…',
    ],
  },
  research: {
    title: 'Researching with Gemini',
    icon: Search,
    estimate: 'usually 10–30 seconds',
    hints: ['Searching approved outside sources…', 'Checking dates and figures…', 'Rating confidence for each finding…', 'Logging findings to the Research Ledger…'],
  },
  revise: {
    title: 'Revising the draft',
    icon: Sparkles,
    estimate: 'the reply streams in as it’s written',
    hints: ['Reading your request…', 'Re-reading the current draft…', 'Starting the revision…'],
  },
  check: {
    title: 'Checking the latest draft',
    icon: ClipboardCheck,
    estimate: 'usually 10–20 seconds',
    hints: ['Counting words against the target…', 'Matching quotes to the sources…', 'Looking for banned words…', 'Checking sourcing and consistency…'],
  },
}

function fmt(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}

function useElapsed() {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1_000)
    return () => clearInterval(t)
  }, [])
  return secs
}

export default function CopywritingLoader({ variant, compact = false }: { variant: CopywritingLoaderVariant; compact?: boolean }) {
  const secs = useElapsed()
  const { title, icon: Icon, estimate, hints } = CONFIG[variant]
  // Rotate every ~6s, holding on the last hint.
  const hint = hints[Math.min(Math.floor(secs / 6), hints.length - 1)]

  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[#e5e3df] bg-[#faf9f7] px-4 py-3">
        <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center">
          <div className="gemini-aurora absolute -inset-0.5 rounded-full opacity-60 blur-md" />
          <div className="relative flex h-8 w-8 items-center justify-center rounded-full border border-[#e5e3df] bg-white">
            <Icon size={14} className="gemini-sparkle text-gray-700" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-800">{title}</p>
          <p className="truncate text-[11px] text-gray-500">{hint}</p>
        </div>
        <span className="flex-shrink-0 text-[10px] font-medium tabular-nums text-gray-400">{fmt(secs)}</span>
      </div>
    )
  }

  return (
    <div className="mt-8 flex flex-col items-center justify-center gap-6 border border-[#e5e3df] bg-white px-6 py-14 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="gemini-aurora absolute -inset-1 rounded-full opacity-70 blur-xl" />
        <div className="gemini-bloom absolute inset-1 rounded-full blur-2xl" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-[#e5e3df] bg-white shadow-sm">
          <Icon size={20} className="gemini-sparkle text-gray-700" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-800">{title}</p>
        <p className="text-xs text-gray-500 transition-opacity duration-500">{hint}</p>
        <p className="text-[11px] font-medium tabular-nums text-gray-400">
          {fmt(secs)} elapsed · {estimate}
        </p>
      </div>

      <div className="flow-line h-[2px] w-40 rounded-full" />
    </div>
  )
}
