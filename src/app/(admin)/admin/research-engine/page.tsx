export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import ResearchEngineSelector, { type ResearchEngineOption } from '@/components/admin/ResearchEngineSelector'
import { geminiConfigured } from '@/lib/gemini/grounding'
import { readResearchSettings } from '@/lib/research-engine'

const OPTIONS: ResearchEngineOption[] = [
  {
    value: 'claude',
    label: 'Claude (web search)',
    description: 'Default. Claude searches the web and writes the research in one step, as it always has. Up to 7 searches per interview.',
  },
  {
    value: 'gemini',
    label: 'Gemini (Google Search)',
    description: 'Gemini plans searches from the category’s themes and runs them on Google, collecting dated facts with the pages they came from. Claude then writes the research from those facts only, under the same prompts. Typically 20–30 searches per interview.',
  },
]

export default async function ResearchEnginePage() {
  requireAdminHeader()

  const { provider, installed } = await readResearchSettings()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Interview Tool', href: '/interview' },
            { label: 'Research Engine' },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Research Engine</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Choose which AI searches the web for each interview&apos;s Background Research. Claude always writes the
            research and the interview questions, following the General and Category prompts.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Web research</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Applies to every new research run and regeneration. Research that has already been generated is not
              changed.
            </p>
            <ResearchEngineSelector
              endpoint="/api/research/settings"
              options={OPTIONS}
              initialProvider={provider}
              geminiConfigured={geminiConfigured()}
              missingKeyNote="GEMINI_API_KEY isn’t set on this server, so research runs on Claude until it is."
              disabledReason={
                installed
                  ? null
                  : 'This setting needs supabase/migrations/040_research_engine.sql to be run first. Until then, research runs on Claude.'
              }
            />
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">How the Gemini option works</h2>
            <ul className="mt-3 flex max-w-2xl list-disc flex-col gap-2 pl-4 text-xs leading-relaxed text-gray-600">
              <li>
                Gemini turns the category&apos;s themes and research targets into a search plan for the interviewee, then
                searches Google for each part at the same time. It always checks the current role and appointment
                date, the country&apos;s latest economic figures and any sanctions or controversies.
              </li>
              <li>
                Every fact comes back with its date and the page it came from. Claude writes the research from those
                facts only and writes N/A for anything they don&apos;t establish.
              </li>
              <li>
                A link Claude didn&apos;t get from the search results is removed and marked &ldquo;unverified link
                removed&rdquo;, so every remaining link points to a page Google actually found.
              </li>
              <li>
                If Gemini fails or finds too little, that interview automatically falls back to Claude&apos;s own web
                search, so research is never blocked.
              </li>
              <li>
                Each interview&apos;s page shows admins which engine did its research. The Gemini searching appears in
                Analytics as &ldquo;Research — Gemini web search&rdquo;.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
