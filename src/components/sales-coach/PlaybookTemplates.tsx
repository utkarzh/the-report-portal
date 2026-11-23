'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BookOpen, Check, ChevronDown, Copy, Info, Mail, MessageCircle, Quote, ArrowUpRight } from 'lucide-react'
import { PLACEHOLDER, isPriceLine, type PlaybookExample, type PlaybookTemplateGroup } from '@/lib/sales-coach-playbook'

// Rafa's example messages from the TRC Retorno Strategy Playbook as ready-to-
// send templates (20 Nov 2026: "he wants users to use that copy paste"), shown
// in the Report Card's Follow-Up section and on the playbook page. The words
// are the playbook's own, line for line; only the layout is ours:
// - each example is "Example 1", "Example 2" with "One offer" / "Two options",
//   instead of the playbook's "ANOTHER OPTION" label, which read like a third
//   option next to the email's own Option 1 / Option 2;
// - inside an email, each offer (its heading, price, "Includes:" and bullets)
//   sits in its own box, so Option 1 and Option 2 read as two choices;
// - placeholders to replace (NAME, COMPANY´S, YOUR NAME AND SIGNATURE EMAIL)
//   are highlighted;
// - Copy puts the exact text on the clipboard.

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers, or a page without clipboard permission.
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function CopyButton({ text, label = 'Copy', tone = 'dark' }: { text: string; label?: string; tone?: 'dark' | 'light' }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <button
      type="button"
      onClick={async () => {
        setState((await copyText(text)) ? 'copied' : 'failed')
        setTimeout(() => setState('idle'), 1800)
      }}
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 touch:py-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8973f]/60 ${
        state === 'copied'
          ? 'bg-emerald-600 text-white'
          : tone === 'dark'
            ? 'bg-stone-900 text-white shadow-[0_1px_2px_rgba(28,25,23,0.25)] hover:bg-black'
            : 'bg-white text-stone-800 ring-1 ring-inset ring-stone-900/15 hover:ring-stone-900/30'
      }`}
      aria-live="polite"
    >
      {state === 'copied' ? <Check size={13} /> : <Copy size={13} />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : label}
    </button>
  )
}

// Placeholders highlighted, everything else as written.
function WithPlaceholders({ text }: { text: string }) {
  const parts = text.split(PLACEHOLDER)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-[#fdf0c7] px-1 py-px font-semibold text-[#7a5418] ring-1 ring-inset ring-[#e6c46f]/60" title="Replace before sending">{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

type EmailPart =
  | { kind: 'line'; text: string }
  | { kind: 'offer'; heading: string; lines: string[] } // heading, price, "Includes:", bullets

// An offer starts at an "Option N …" line or a line just above a price line,
// and runs through its price, "Includes:" and bullets.
function emailParts(lines: string[]): EmailPart[] {
  const parts: EmailPart[] = []
  let i = 0
  const belongs = (l: string) => isPriceLine(l) || /^includes\s*:?$/i.test(l.trim()) || l.startsWith('• ')
  while (i < lines.length) {
    const l = lines[i]
    const startsOffer = /^option\s+\d+\b/i.test(l.trim()) || (i + 1 < lines.length && isPriceLine(lines[i + 1]) && !isPriceLine(l))
    if (startsOffer) {
      const offer: EmailPart = { kind: 'offer', heading: l, lines: [] }
      i++
      while (i < lines.length && belongs(lines[i])) { offer.lines.push(lines[i]); i++ }
      parts.push(offer)
      continue
    }
    parts.push({ kind: 'line', text: l })
    i++
  }
  return parts
}

function OfferBox({ heading, lines }: { heading: string; lines: string[] }) {
  const bullets = lines.filter((l) => l.startsWith('• '))
  return (
    <div className="my-1 rounded-xl bg-[#fbf9f4] px-4 py-3.5 ring-1 ring-inset ring-[#e8dfcc]">
      <p className="font-semibold text-stone-900"><WithPlaceholders text={heading} /></p>
      {lines.filter((l) => !l.startsWith('• ')).map((l, i) => {
        if (isPriceLine(l)) {
          const at = l.indexOf(':')
          return (
            <p key={i} className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-stone-600">{l.slice(0, at + 1)}</span>
              <span className="font-semibold tabular-nums text-[#7a5418]">{l.slice(at + 1).trim()}</span>
            </p>
          )
        }
        return <p key={i} className="mt-2 text-[12.5px] font-semibold text-stone-700">{l}</p>
      })}
      {bullets.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2"><span aria-hidden className="mt-[0.6em] h-1 w-1 flex-shrink-0 rounded-full bg-[#b8862f]" /><span><WithPlaceholders text={b.slice(2)} /></span></li>
          ))}
        </ul>
      )}
    </div>
  )
}

const CHANNEL = {
  email: { label: 'Email', icon: <Mail size={12} />, chip: 'bg-sky-50 text-sky-800 ring-sky-600/20' },
  whatsapp: { label: 'WhatsApp', icon: <MessageCircle size={12} />, chip: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20' },
  wording: { label: 'Wording', icon: <Quote size={12} />, chip: 'bg-stone-100 text-stone-700 ring-stone-500/20' },
} as const

function exampleDescriptor(e: PlaybookExample): string | null {
  if (e.optionCount >= 2) return `${e.optionCount} options to choose from`
  if (e.hasOffer) return 'One offer'
  return null
}

export function TemplateCard({ example: e, heading }: { example: PlaybookExample; heading?: string }) {
  const [expanded, setExpanded] = useState(false)
  const ch = CHANNEL[e.channel]
  const long = e.lines.length > 12
  const descriptor = exampleDescriptor(e)
  const title = heading ?? (e.count > 1 ? `Example ${e.index}` : 'Example')

  return (
    <div id={e.key} className="flex scroll-mt-24 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(28,25,23,0.05),0_10px_26px_-20px_rgba(28,25,23,0.35)] ring-1 ring-[#e6e2da] transition-shadow">
      <div className="flex items-center justify-between gap-3 border-b border-[#efece6] bg-[#fcfbf9] px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset ${ch.chip}`}>{ch.icon}{ch.label}</span>
          <span className="text-[13px] font-semibold text-stone-900">{title}</span>
          {descriptor && <span className="text-[12px] text-stone-500">· {descriptor}</span>}
        </div>
        <CopyButton text={e.copyText} label={e.channel === 'email' ? 'Copy email' : e.channel === 'whatsapp' ? 'Copy message' : 'Copy'} />
      </div>

      {e.channel === 'whatsapp' ? (
        <div className="flex-1 bg-[#f4f1ea] px-4 py-5 [background-image:radial-gradient(rgba(28,25,23,0.035)_1px,transparent_1px)] [background-size:14px_14px]">
          <div className="relative ml-auto max-w-[34rem] rounded-2xl rounded-tr-md bg-[#dcf5d0] px-4 py-3 text-[14px] leading-[1.6] text-stone-900 shadow-[0_1px_1px_rgba(28,25,23,0.12)]">
            <WithPlaceholders text={e.copyText} />
          </div>
        </div>
      ) : e.channel === 'wording' || e.lines.length === 1 ? (
        <div className="flex-1 px-5 py-4">
          <p className="border-l-2 border-[#d4b06a] pl-4 text-[14.5px] italic leading-[1.7] text-stone-800"><WithPlaceholders text={e.copyText} /></p>
        </div>
      ) : (
        <div className="relative flex-1">
          <div className={`space-y-2 px-5 py-4 text-[14px] leading-[1.65] text-stone-800 ${long && !expanded ? 'max-h-[25rem] overflow-hidden' : ''}`}>
            {emailParts(e.lines).map((p, i) =>
              p.kind === 'offer' ? <OfferBox key={i} heading={p.heading} lines={p.lines} /> : <p key={i}><WithPlaceholders text={p.text} /></p>,
            )}
          </div>
          {long && (
            <div className={`${expanded ? '' : 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/95 to-transparent pt-14'} flex justify-center px-4 pb-3`}>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 touch:py-2.5 text-xs font-medium text-stone-600 shadow-sm ring-1 ring-inset ring-stone-900/10 hover:text-stone-900"
              >
                <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                {expanded ? 'Show less' : 'Show the whole email'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function PlaybookNote({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2.5 rounded-xl bg-[#fff8e6] px-4 py-3 text-[13.5px] leading-[1.6] text-[#6b4a12] ring-1 ring-inset ring-[#e9c977]/60">
      <Info size={15} className="mt-0.5 flex-shrink-0 text-[#b8862f]" />
      <span>{text}</span>
    </p>
  )
}

// The Report Card's playbook panel: the playbook itself, prominent, then its
// ready-to-send messages grouped by tactic.
export function PlaybookTemplatesPanel({ groups, playbookHref }: { groups: PlaybookTemplateGroup[]; playbookHref?: string }) {
  const wide = groups.filter((g) => g.examples.length > 1 || g.examples.some((e) => e.lines.length > 3))
  const short = groups.filter((g) => !wide.includes(g))
  return (
    <div className="mt-6 overflow-hidden rounded-2xl ring-1 ring-[#e3d9c4]">
      <div className="relative flex flex-col gap-4 bg-gradient-to-br from-[#fdf9f0] via-[#faf3e2] to-[#f5e9cf] px-5 py-5 sm:flex-row sm:items-center sm:px-7">
        <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white text-[#8f6626] shadow-[0_1px_2px_rgba(160,117,48,0.2)] ring-1 ring-inset ring-[#d9bf8a]/70">
          <BookOpen size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#8f6626]">Your follow-up playbook</p>
          <p className="mt-0.5 font-serif text-[19px] font-semibold leading-snug text-stone-900">TRC Retorno Strategy Playbook</p>
          <p className="mt-1 text-[13px] leading-5 text-stone-600">Every follow-up tactic, when it works best, and ready-to-send messages to copy below.</p>
        </div>
        {playbookHref && (
          <Link
            href={playbookHref}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 touch:py-3.5 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(28,25,23,0.6)] transition hover:bg-black"
          >
            <BookOpen size={15} /> Read the full playbook
            <ArrowUpRight size={15} className="transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>

      {groups.length > 0 && (
        <div className="border-t border-[#ebe2cf] bg-white px-5 py-6 sm:px-7">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-stone-500">Ready-to-send messages</p>
          <p className="mt-1 text-[13px] text-stone-500">Copy one, then replace the <mark className="rounded bg-[#fdf0c7] px-1 font-semibold text-[#7a5418]">HIGHLIGHTED</mark> words and adapt it to this meeting.</p>

          <div className="mt-5 flex flex-col gap-7">
            {wide.map((g) => <TemplateGroupBlock key={g.tacticNumber ?? g.tactic} group={g} />)}
            {short.length > 0 && (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
                {short.map((g) => <TemplateGroupBlock key={g.tacticNumber ?? g.tactic} group={g} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TemplateGroupBlock({ group: g }: { group: PlaybookTemplateGroup }) {
  return (
    <section id={g.tacticNumber ? `pb-template-${g.tacticNumber.replace('.', '-')}` : undefined} className="flex scroll-mt-24 flex-col rounded-2xl transition-colors duration-700">
      <p className="flex items-baseline gap-2 text-[14px] font-semibold text-stone-900">
        {g.tacticNumber && <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-stone-600">{g.tacticNumber}</span>}
        {g.tactic}
      </p>
      {g.hints.map((h, i) => <p key={i} className="mt-1 text-[13px] text-stone-500">{h}</p>)}
      <div className={`mt-3 grid flex-1 grid-cols-1 gap-4 ${g.examples.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {g.examples.map((e) => <TemplateCard key={e.key} example={e} />)}
      </div>
      {g.notes.length > 0 && <div className="mt-3 flex flex-col gap-2">{g.notes.map((n, i) => <PlaybookNote key={i} text={n} />)}</div>}
    </section>
  )
}

// Scroll to a tactic's templates in the panel and flash it.
export function showTemplateGroup(tacticNumber: string) {
  const el = document.getElementById(`pb-template-${tacticNumber.replace('.', '-')}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el.classList.add('bg-[#fbf3df]', 'ring-4', 'ring-[#fbf3df]')
  setTimeout(() => el.classList.remove('bg-[#fbf3df]', 'ring-4', 'ring-[#fbf3df]'), 1800)
}
