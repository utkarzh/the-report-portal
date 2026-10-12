import Link from 'next/link'
import { BookOpen, FileText, Link2, PlayCircle, Sparkles } from 'lucide-react'
import { initials } from '@/lib/knowledge/format'
import type { KnowledgeItemType } from '@/types'

// Small presentational pieces shared by every Knowledge Base page, so the
// module reads as one system: item type tiles, people avatars, department
// monograms, stat tiles, section headings and empty states.

export const TYPE_ICONS: Record<KnowledgeItemType, React.ElementType> = {
  document: FileText,
  text: BookOpen,
  video: PlayCircle,
  link: Link2,
}

const TILE_SIZES = {
  sm: { box: 'h-7 w-7 rounded-md', icon: 13 },
  md: { box: 'h-9 w-9 rounded-lg', icon: 16 },
  lg: { box: 'h-11 w-11 rounded-xl', icon: 19 },
} as const

export function TypeTile({ type, size = 'md', example = false }: { type: KnowledgeItemType; size?: keyof typeof TILE_SIZES; example?: boolean }) {
  const Icon = TYPE_ICONS[type]
  const s = TILE_SIZES[size]
  return (
    <span
      className={`inline-flex ${s.box} flex-shrink-0 items-center justify-center border ${
        example ? 'border-[#c8973f]/30 bg-[#fbf7ed] text-[#a07530]' : 'border-[#eceae5] bg-[#f7f6f3] text-gray-600'
      }`}
    >
      <Icon size={s.icon} strokeWidth={1.75} />
    </span>
  )
}

const AVATAR_SIZES = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-[11px]',
} as const

export function Avatar({ name, size = 'sm' }: { name: string | null | undefined; size?: keyof typeof AVATAR_SIZES }) {
  return (
    <span
      title={name ?? undefined}
      className={`inline-flex ${AVATAR_SIZES[size]} flex-shrink-0 items-center justify-center rounded-full bg-[#ebe8e2] font-semibold text-[#5f584c] ring-1 ring-white`}
    >
      {initials(name)}
    </span>
  )
}

const MONOGRAM_SIZES = {
  sm: 'h-8 w-8 rounded-lg text-[11px]',
  md: 'h-10 w-10 rounded-xl text-xs',
  lg: 'h-12 w-12 rounded-xl text-sm',
} as const

export function DeptMonogram({ name, size = 'md', muted = false }: { name: string; size?: keyof typeof MONOGRAM_SIZES; muted?: boolean }) {
  return (
    <span
      className={`inline-flex ${MONOGRAM_SIZES[size]} flex-shrink-0 items-center justify-center font-semibold tracking-wide ${
        muted ? 'bg-[#ebe8e2] text-gray-500' : 'bg-black text-white'
      }`}
    >
      {initials(name)}
    </span>
  )
}

export function ExampleBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-[#c8973f]/25 bg-[#fbf7ed] px-2 py-0.5 text-[10px] font-medium text-[#a07530]">
      <Sparkles size={10} /> {compact ? 'Example' : 'Example of excellent work'}
    </span>
  )
}

export function SectionHeader({ title, count, action }: { title: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
        {title}
        {typeof count === 'number' && <span className="ml-1.5 font-medium text-gray-400">{count.toLocaleString('en-US')}</span>}
      </h2>
      {action}
    </div>
  )
}

const STAT_TONES = {
  default: 'text-gray-900',
  amber: 'text-amber-700',
  red: 'text-red-700',
  emerald: 'text-emerald-700',
} as const

export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
  href,
}: {
  label: string
  value: number | string
  sub?: string
  icon?: React.ElementType
  tone?: keyof typeof STAT_TONES
  href?: string
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{label}</p>
        {Icon && <Icon size={14} strokeWidth={1.75} className="text-gray-300" />}
      </div>
      <p className={`mt-2 text-xl font-semibold tabular-nums leading-none tracking-tight ${STAT_TONES[tone]}`}>
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
      </p>
      {sub && <p className="mt-1.5 truncate text-[11px] text-gray-400">{sub}</p>}
    </>
  )
  const cls = 'block rounded-xl border border-[#e5e3df] bg-white p-4 shadow-sm'
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-gray-300`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className = '',
}: {
  icon: React.ElementType
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center rounded-2xl border border-dashed border-[#d9d5cc] bg-white/60 px-6 py-12 text-center ${className}`}>
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#eceae5] bg-white text-gray-500 shadow-sm">
        <Icon size={19} strokeWidth={1.75} />
      </span>
      <p className="mt-4 text-sm font-semibold text-gray-900">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-gray-500">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

// Filter chips that live in the URL (?status=, ?type=…) on server pages.
export function FilterChips({ options, active }: { options: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const on = o.key === active
        return (
          <Link
            key={o.key}
            href={o.href}
            scroll={false}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              on ? 'bg-black text-white' : 'border border-[#e5e3df] bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
            }`}
          >
            {o.label}
            {typeof o.count === 'number' && <span className={`tabular-nums ${on ? 'text-white/60' : 'text-gray-400'}`}>{o.count}</span>}
          </Link>
        )
      })}
    </div>
  )
}
