'use client'

import ResearchEngineSelector, { type ResearchEngineOption } from '@/components/admin/ResearchEngineSelector'
import type { InterviewLetterResearchProvider } from '@/types'

interface Props {
  initialProvider: InterviewLetterResearchProvider
  geminiConfigured: boolean
}

const OPTIONS: ResearchEngineOption[] = [
  {
    value: 'gemini',
    label: 'Gemini (Google Search)',
    description: 'Recommended. Checks the Editorial Brief against live Google Search results and adds anything new. Sources are linked from the actual search results. Lower cost.',
  },
  {
    value: 'claude',
    label: 'Claude (web search)',
    description: 'Runs the same check with Claude’s web search tool. Uses a shorter extract of the Editorial Brief.',
  },
]

export default function InterviewLetterResearchEngine({ initialProvider, geminiConfigured }: Props) {
  return (
    <ResearchEngineSelector
      endpoint="/api/interview-letters/settings"
      options={OPTIONS}
      initialProvider={initialProvider}
      geminiConfigured={geminiConfigured}
      missingKeyNote="GEMINI_API_KEY isn’t set on this server, so research is running on Claude until it is."
    />
  )
}
