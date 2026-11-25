export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { BookOpen, BookOpenText, PencilLine } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isSalesCoachAdminEmail } from '@/lib/sales-coach-admins'
import { parsePlaybook, type PlaybookItem, type PlaybookSection, type PlaybookTactic } from '@/lib/sales-coach-playbook'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import { PlaybookNote, TemplateCard } from '@/components/sales-coach/PlaybookTemplates'

// The TRC Retorno Strategy Playbook (Rafa, 14 Nov 2026), read-only, for every
// Sales Executive with Sales Coach access (middleware gates /commercial/
// sales-coach). It is the 'followup_playbook' knowledge document itself, the
// same text the Follow-Up Decision Support and the coaches read, so there is
// one copy to maintain: Rafa edits it in the admin area and this page follows.
//
// Laid out for reading (20 Nov 2026, "the formatting is not proper"): a
// contents list that jumps to each section and tactic, each tactic as a card
// with its effort and when it works best up front, the rules as numbered
// pointers, and every example as a card with Copy. Section 6, "The Role of AI
// and the Sales Executive", was written for the developers and isn't shown
// (still in the document the AI reads). Same words throughout.
export default async function SalesCoachPlaybookPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const { data } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .select('content, updated_at')
    .eq('doc_key', 'followup_playbook')
    .maybeSingle()
  const text = (data?.content || '').trim()
  const doc = text && !text.toUpperCase().startsWith('PLACEHOLDER') ? parsePlaybook(text) : null
  const sections = (doc?.sections || []).filter((s) => !s.hidden)
  const canEdit = isSalesCoachAdminEmail(profile.email)

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <Breadcrumbs items={[{ label: 'Sales Coach', href: '/commercial/sales-coach' }, { label: 'Follow-Up Playbook' }]} />

        <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#fdf9f0] via-[#faf3e2] to-[#f3e5c6] px-5 py-6 ring-1 ring-[#e3d9c4] sm:px-8 sm:py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-white text-[#8f6626] shadow-[0_1px_2px_rgba(160,117,48,0.2)] ring-1 ring-inset ring-[#d9bf8a]/70">
              <BookOpen size={26} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-[26px] font-semibold leading-tight tracking-tight text-stone-900 sm:text-[32px]">{doc?.title || 'TRC Retorno Strategy Playbook'}</h1>
              {/* "Prepared by Rafa, 14.11.2026 - Internal": for the Sales Coach
                  admins only (24 Nov 2026, Rafa: "this cannot be seen by any
                  users"). Still in the document the AI reads. */}
              {canEdit && doc?.subtitle && <p className="mt-1 text-sm text-stone-600">{doc.subtitle}</p>}
            </div>
            {canEdit && (
              <Link
                href="/commercial/admin/sales-coach/knowledge/followup_playbook"
                className="inline-flex flex-shrink-0 items-center gap-1.5 self-start rounded-lg bg-white/80 px-3 py-1.5 touch:py-2.5 text-xs font-medium text-[#8f6626] ring-1 ring-inset ring-[#c8973f]/40 hover:bg-white sm:self-center"
              >
                <PencilLine size={13} /> Edit in admin
              </Link>
            )}
          </div>
        </header>

        {!doc || sections.length === 0 ? (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[#e5e3df] bg-white p-6 text-sm text-gray-500">
            <BookOpenText size={18} className="mt-0.5 flex-shrink-0 text-gray-400" />
            <p>The playbook hasn&apos;t been published yet.</p>
          </div>
        ) : (
          <div className="mt-6 lg:grid lg:grid-cols-[16rem,minmax(0,1fr)] lg:items-start lg:gap-8">
            <Contents sections={sections} />
            <article className="mt-6 flex min-w-0 flex-col gap-6 lg:mt-0">
              {sections.map((s) => <SectionCard key={s.id} section={s} />)}
            </article>
          </div>
        )}
      </div>
    </div>
  )
}

function Contents({ sections }: { sections: PlaybookSection[] }) {
  return (
    <nav aria-label="Contents" className="rounded-2xl bg-white px-4 py-4 ring-1 ring-[#e6e2da] lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
      <p className="px-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-stone-500">Contents</p>
      <ol className="mt-2 flex flex-col gap-0.5">
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 touch:py-2.5 text-[13.5px] font-medium text-stone-800 transition-colors hover:bg-[#faf6ec] hover:text-stone-950">
              <span className="mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-stone-900 text-[10.5px] font-semibold tabular-nums text-white">{s.number}</span>
              {s.title}
            </a>
            {s.tactics.length > 0 && (
              <ol className="mb-1 ml-[1.15rem] mt-0.5 flex flex-col border-l border-[#ebe7e0] pl-3">
                {s.tactics.map((t) => (
                  <li key={t.id}>
                    <a href={`#${t.id}`} className="flex gap-2 rounded-md px-1.5 py-1 touch:py-2 text-[12.5px] text-stone-600 transition-colors hover:bg-[#faf6ec] hover:text-stone-900">
                      <span className="tabular-nums text-stone-400">{t.number}</span>{t.title}
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function SectionCard({ section: s }: { section: PlaybookSection }) {
  return (
    <section id={s.id} className="scroll-mt-20 rounded-2xl bg-white px-5 py-6 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_14px_34px_-26px_rgba(28,25,23,0.28)] ring-1 ring-[#e6e2da] sm:px-8 sm:py-8">
      <h2 className="flex items-center gap-3.5">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-b from-[#fdfaf3] to-[#f4e9d1] font-serif text-[17px] font-semibold text-[#8a6224] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-inset ring-[#d9bf8a]/70">{s.number}</span>
        <span className="font-serif text-[21px] font-semibold leading-tight tracking-[-0.01em] text-stone-900 sm:text-[23px]">{s.title}</span>
      </h2>
      {s.items.length > 0 && <div className="mt-2"><Items items={s.items} /></div>}
      {s.tactics.length > 0 && (
        <div className="mt-6 flex flex-col gap-5">
          {s.tactics.map((t) => <TacticCard key={t.id} tactic={t} />)}
        </div>
      )}
    </section>
  )
}

// "Low." → Low; "Moderate. Requires coordination…" → Moderate + the rest.
function splitEffort(effort: string): { level: string; rest: string } {
  const m = /^([^.]+)\.\s*(.*)$/.exec(effort.trim())
  return m ? { level: m[1], rest: m[2] } : { level: effort.trim(), rest: '' }
}

function TacticCard({ tactic: t }: { tactic: PlaybookTactic }) {
  const effort = t.effort ? splitEffort(t.effort) : null
  return (
    <div id={t.id} className="scroll-mt-20 overflow-hidden rounded-2xl ring-1 ring-[#e6e2da]">
      <div className="border-b border-[#efece6] bg-[#fcfbf9] px-5 py-4 sm:px-6">
        <h3 className="flex items-baseline gap-2.5">
          <span className="rounded-md bg-stone-900 px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums text-white">{t.number}</span>
          <span className="text-[17px] font-semibold tracking-[-0.01em] text-stone-900">{t.title}</span>
        </h3>
        {effort && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-stone-500">
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 font-semibold text-stone-700 ring-1 ring-inset ring-stone-900/10">
              Effort: <span className="text-stone-950">{effort.level}</span>
            </span>
            {effort.rest && <span>{effort.rest}</span>}
          </p>
        )}
      </div>
      <div className="px-5 py-5 sm:px-6">
        {t.whenBest && (
          <div className="rounded-xl bg-[#fbf7ee] px-4 py-3 ring-1 ring-inset ring-[#c8973f]/25">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#8f6626]">When it works best</p>
            <p className="mt-1 text-[14.5px] font-medium leading-[1.6] text-stone-900">{t.whenBest}</p>
          </div>
        )}
        <Items items={t.items} />
      </div>
    </div>
  )
}

const LABEL_TONE = {
  strong: 'border-emerald-500 bg-emerald-50/60',
  uncertain: 'border-amber-500 bg-amber-50/60',
  weak: 'border-rose-400 bg-rose-50/60',
} as const

function Items({ items }: { items: PlaybookItem[] }) {
  return (
    <div className="text-[15px] leading-7 text-stone-700">
      {items.map((it, i) => {
        switch (it.kind) {
          case 'intro':
            return <p key={i} className="mt-4 font-semibold text-stone-900">{it.text}</p>
          case 'bullets':
            return (
              <ul key={i} className="mt-2 space-y-1.5">
                {it.items.map((b, j) => (
                  <li key={j} className="flex gap-2.5"><span aria-hidden className="mt-[0.7em] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#c8973f]" /><span>{b}</span></li>
                ))}
              </ul>
            )
          case 'numbered':
            return (
              <ol key={i} className="mt-2 list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-stone-400">
                {it.items.map((b, j) => <li key={j}>{b}</li>)}
              </ol>
            )
          case 'pointers':
            return (
              <ol key={i} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2">
                {it.items.map((p, j) => (
                  <li key={j} className="flex gap-3 rounded-xl bg-[#faf8f5] px-4 py-3.5 ring-1 ring-inset ring-[#ece8e1]">
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-semibold tabular-nums text-white">{j + 1}</span>
                    <p className="text-[14.5px] leading-[1.6]"><span className="font-semibold text-stone-950">{p.lead}</span> {p.text}</p>
                  </li>
                ))}
              </ol>
            )
          case 'labelled':
            if (it.tone === 'note') return <div key={i} className="mt-4"><PlaybookNote text={`${it.label}: ${it.text}`} /></div>
            if (it.tone === 'plain') return <p key={i} className="mt-3"><span className="font-semibold text-stone-900">{it.label}:</span> {it.text}</p>
            return (
              <p key={i} className={`mt-3 rounded-r-xl border-l-4 px-4 py-3 text-[14.5px] leading-[1.6] ${LABEL_TONE[it.tone]}`}>
                <span className="font-semibold text-stone-950">{it.label}:</span> {it.text}
              </p>
            )
          case 'example':
            return <div key={i} className="mt-4"><TemplateCard example={it.example} /></div>
          default:
            return <p key={i} className="mt-3">{it.text}</p>
        }
      })}
    </div>
  )
}
