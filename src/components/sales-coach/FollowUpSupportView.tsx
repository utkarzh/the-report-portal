'use client'

import { useState } from 'react'
import Link from 'next/link'
import { marked } from 'marked'
import { AlertTriangle, ArrowUpRight, BookOpen, Clock, Crosshair, Gauge, Info, ListChecks, Mail, MessageCircle, UserCheck } from 'lucide-react'
import type { FollowUpView, InterestTone } from '@/lib/sales-coach-follow-up-view'
import { templateGroupForAction, type PlaybookTemplateGroup } from '@/lib/sales-coach-playbook'
import { PlaybookTemplatesDialog } from '@/components/sales-coach/PlaybookTemplates'

// The Follow-Up Decision Support laid out in its four parts (20 Nov 2026,
// Rafa: the AI says a lot and people may not read it all, so what to do must
// stand out). Every word the model wrote is shown; only the layout changes:
// the interest verdict is a badge, each recommended action is a card whose
// timing and objective lead, the watch-out is a warning, and the decision is
// its own panel.
//
// 24 Nov 2026 (Rafa's Loom): part 2 is headed "Next possible actions", with
// "Make your decisions by reading the Retorno Playbook" beside it; a WhatsApp action
// gets "See possible WhatsApp templates" and the proposal email "See email
// proposal template", each opening the playbook's templates in a pop-up (they
// replaced the playbook panel under the section).
const ACTIONS_HEADING = 'Next possible actions'

const onlyWhatsApp = (g: PlaybookTemplateGroup) => g.examples.every((e) => e.channel === 'whatsapp')

interface TemplateButton { label: string; channel: 'whatsapp' | 'email'; title: string; groups: PlaybookTemplateGroup[] }

// The pop-up buttons for one action: the playbook's WhatsApp messages when the
// action is a WhatsApp, and the template of the tactic it matches (the
// proposal email, the contract…) unless that is a WhatsApp already offered.
function templateButtons(title: string, templates: PlaybookTemplateGroup[], whatsapp: PlaybookTemplateGroup[]): TemplateButton[] {
  const out: TemplateButton[] = []
  const isWhatsApp = /whats\s*app/i.test(title)
  if (isWhatsApp && whatsapp.length > 0) {
    out.push({ label: 'See possible WhatsApp templates', channel: 'whatsapp', title: 'Possible WhatsApp templates', groups: whatsapp })
  }
  const group = templateGroupForAction(title, templates)
  if (group && !(isWhatsApp && onlyWhatsApp(group))) {
    out.push({
      label: /proposal/i.test(group.tactic || '') ? 'See email proposal template' : `Use the playbook ${onlyWhatsApp(group) ? 'message' : 'template'}`,
      channel: onlyWhatsApp(group) ? 'whatsapp' : 'email',
      title: group.tactic || 'Playbook template',
      groups: [group],
    })
  }
  return out
}

// Markdown from the model; any HTML in it is shown as text, never rendered.
function md(text: string, inline = false): string {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return (inline ? marked.parseInline(safe, { gfm: true, async: false }) : marked.parse(safe, { gfm: true, breaks: true, async: false })) as string
}

function Md({ text, className = '' }: { text: string; className?: string }) {
  // Its own light styles, not .pattern-prose: that caps text at 44rem, which
  // would leave an empty strip on the right of these wide cards.
  return (
    <div
      className={`min-w-0 [&_p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li]:marker:text-stone-400 [&_strong]:font-semibold [&_strong]:text-stone-900 ${className}`}
      dangerouslySetInnerHTML={{ __html: md(text) }}
    />
  )
}

function Inline({ text }: { text: string }) {
  return <span dangerouslySetInnerHTML={{ __html: md(text, true) }} />
}

const TONE: Record<InterestTone, { pill: string; dot: string; bar: string }> = {
  strong: { pill: 'bg-emerald-50 text-emerald-800 ring-emerald-600/25', dot: 'bg-emerald-500', bar: 'from-emerald-400 to-emerald-600' },
  uncertain: { pill: 'bg-amber-50 text-amber-900 ring-amber-600/30', dot: 'bg-amber-500', bar: 'from-amber-300 to-amber-500' },
  weak: { pill: 'bg-rose-50 text-rose-800 ring-rose-600/25', dot: 'bg-rose-500', bar: 'from-rose-300 to-rose-500' },
  neutral: { pill: 'bg-stone-100 text-stone-700 ring-stone-500/20', dot: 'bg-stone-400', bar: 'from-stone-300 to-stone-400' },
}

function PartHeading({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h4 className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em] text-stone-900">
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[12px] font-semibold tabular-nums text-white">{n}</span>
      <span className="text-stone-400">{icon}</span>
      {children}
    </h4>
  )
}

export default function FollowUpSupportView({ view, templates = [], playbookHref }: { view: FollowUpView; templates?: PlaybookTemplateGroup[]; playbookHref?: string }) {
  const { interest, actions, watchOut, decision } = view
  const [dialog, setDialog] = useState<{ title: string; groups: PlaybookTemplateGroup[] } | null>(null)
  // Every WhatsApp message in the playbook, by tactic.
  const whatsapp = templates
    .map((g) => ({ ...g, examples: g.examples.filter((e) => e.channel === 'whatsapp') }))
    .filter((g) => g.examples.length > 0)
  let n = 0
  return (
    <div className="flex flex-col gap-7">
      {view.preamble.length > 0 && (
        <p className="text-[13px] text-stone-500">{view.preamble.map((p, i) => <Inline key={i} text={p.replace(/\*\*/g, '')} />)}</p>
      )}

      {/* 1. Commercial interest */}
      {interest && (
        <section>
          <PartHeading n={++n} icon={<Gauge size={15} />}>{interest.heading}</PartHeading>
          <div className="mt-3 overflow-hidden rounded-2xl bg-white ring-1 ring-[#e6e2da]">
            <div className={`h-1 bg-gradient-to-r ${TONE[interest.tone].bar}`} />
            <div className="px-5 py-4 sm:px-6">
              {interest.verdict && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-bold uppercase tracking-[0.06em] ring-1 ring-inset ${TONE[interest.tone].pill}`}>
                    <span className={`h-2 w-2 rounded-full ${TONE[interest.tone].dot}`} />{interest.verdict}
                  </span>
                  {interest.qualifier && <span className="text-[14px] font-medium text-stone-700">{interest.qualifier}</span>}
                </p>
              )}
              {interest.body && <Md text={interest.body} className={`${interest.verdict ? 'mt-3' : ''} text-[14.5px] leading-[1.7] text-stone-700`} />}
            </div>
          </div>
        </section>
      )}

      {/* 2. Recommended actions */}
      {actions && (
        <section>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <PartHeading n={++n} icon={<ListChecks size={15} />}>{ACTIONS_HEADING}</PartHeading>
            {playbookHref && (
              <Link
                href={playbookHref}
                target="_blank"
                rel="noopener noreferrer"
                className="sc-playbook-btn group inline-flex flex-shrink-0 items-center justify-center gap-2 self-start rounded-xl px-5 py-3 touch:py-3.5 text-sm font-semibold text-white sm:self-center"
              >
                <BookOpen size={15} className="flex-shrink-0 text-[#e8c27a]" /> Make your decisions by reading the Retorno Playbook
                <ArrowUpRight size={15} className="flex-shrink-0 text-[#e8c27a] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            )}
          </div>
          {actions.intro && <Md text={actions.intro} className="mt-2 text-[14px] leading-[1.65] text-stone-600" />}
          <ol className="mt-3 flex flex-col gap-3.5">
            {actions.items.map((a) => {
              const buttons = templateButtons(a.title, templates, whatsapp)
              const objective = a.fields.filter((f) => /objective|goal/i.test(f.label))
              const when = a.fields.filter((f) => /when|timing/i.test(f.label))
              const rest = a.fields.filter((f) => !objective.includes(f) && !when.includes(f))
              return (
                <li key={a.number} className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04),0_12px_28px_-24px_rgba(28,25,23,0.4)] ring-1 ring-[#e6e2da]">
                  <div className="flex flex-col gap-3 border-b border-[#efece6] bg-[#fcfbf9] px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-b from-[#fdfaf3] to-[#f4e9d1] font-serif text-[15px] font-semibold text-[#8a6224] ring-1 ring-inset ring-[#d9bf8a]/70">{a.number}</span>
                      <div className="min-w-0 pt-0.5">
                        <p className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-stone-900"><Inline text={a.title} /></p>
                        {a.timing && (
                          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-stone-900 px-2.5 py-0.5 text-[11.5px] font-semibold text-white">
                            <Clock size={11} /> {a.timing}
                          </span>
                        )}
                      </div>
                    </div>
                    {buttons.length > 0 && (
                      <div className="flex flex-shrink-0 flex-wrap gap-2 self-start sm:self-center">
                        {buttons.map((b) => (
                          <button
                            key={b.label}
                            type="button"
                            onClick={() => setDialog({ title: b.title, groups: b.groups })}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 touch:py-2.5 text-xs font-semibold text-[#7a5418] ring-1 ring-inset ring-[#d9bf8a] transition hover:bg-[#fbf3df]"
                          >
                            {b.channel === 'whatsapp' ? <MessageCircle size={13} /> : <Mail size={13} />} {b.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-3 px-5 py-4 sm:px-6">
                    {objective.map((f, i) => (
                      <div key={`o${i}`} className="rounded-xl bg-[#fbf7ee] px-4 py-3 ring-1 ring-inset ring-[#c8973f]/25">
                        <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#8f6626]"><Crosshair size={12} /> {f.label}</p>
                        <p className="mt-1 text-[14.5px] font-medium leading-[1.6] text-stone-900"><Inline text={f.text} /></p>
                      </div>
                    ))}
                    {when.map((f, i) => (
                      <p key={`w${i}`} className="flex items-start gap-2 text-[14px] leading-[1.6] text-stone-800">
                        <Clock size={14} className="mt-[3px] flex-shrink-0 text-stone-400" />
                        <span><span className="font-semibold text-stone-900">{f.label}: </span><Inline text={f.text} /></span>
                      </p>
                    ))}
                    {rest.map((f, i) => (
                      <p key={`r${i}`} className={`text-[14px] leading-[1.65] ${f.label === 'Note' ? 'text-stone-500' : 'text-stone-600'}`}>
                        <span className="font-semibold text-stone-800">{f.label}: </span><Inline text={f.text} />
                      </p>
                    ))}
                    {a.extra.map((x, i) => <Md key={`x${i}`} text={x} className="text-[14px] leading-[1.65] text-stone-600" />)}
                  </div>
                </li>
              )
            })}
          </ol>
          {actions.notes.map((t, i) => (
            <p key={i} className="mt-3 flex items-start gap-2 text-[13.5px] leading-[1.6] text-stone-600">
              <Info size={14} className="mt-[3px] flex-shrink-0 text-stone-400" />
              <span><span className="font-semibold text-stone-800">Note: </span><Inline text={t} /></span>
            </p>
          ))}
        </section>
      )}

      {/* 3. Watch-out */}
      {watchOut && (
        <section>
          <PartHeading n={++n} icon={<AlertTriangle size={15} />}>{watchOut.heading}</PartHeading>
          <div className="mt-3 flex gap-3 rounded-2xl bg-[#fff7ea] px-5 py-4 ring-1 ring-inset ring-amber-500/30 sm:px-6">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
            <Md text={watchOut.body} className="text-[14.5px] leading-[1.7] text-stone-800" />
          </div>
        </section>
      )}

      {/* 4. Executive decision */}
      {decision && (
        <section>
          <PartHeading n={++n} icon={<UserCheck size={15} />}>{decision.heading}</PartHeading>
          <div className="mt-3 rounded-2xl border-l-4 border-[#c8973f] bg-white px-5 py-4 ring-1 ring-[#e6e2da] sm:px-6">
            <Md text={decision.body} className="text-[14.5px] leading-[1.7] text-stone-800 [&_strong]:rounded [&_strong]:bg-[#fbf3df] [&_strong]:px-1 [&_strong]:text-stone-950" />
          </div>
        </section>
      )}

      {view.other.map((o, i) => (
        <section key={i}>
          <PartHeading n={++n} icon={<Info size={15} />}>{o.heading}</PartHeading>
          <Md text={o.body} className="mt-3 text-[14.5px] leading-[1.7] text-stone-700" />
        </section>
      ))}

      {dialog && <PlaybookTemplatesDialog title={dialog.title} groups={dialog.groups} onClose={() => setDialog(null)} />}
    </div>
  )
}
