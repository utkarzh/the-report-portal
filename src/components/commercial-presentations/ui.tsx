'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

// Small visual primitives shared by every Commercial Presentation screen, so
// the workspace and the admin area look the same as the rest of the app
// (rounded white cards, black primary actions).

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[#e5e3df] bg-white p-5 shadow-sm sm:p-6 ${className}`}>{children}</section>
}

export function CardHeader({
  step,
  title,
  description,
  action,
}: {
  step?: string
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {step && <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">{step}</p>}
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-500">{description}</p>}
      </div>
      {action && <div className="flex flex-shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; icon?: ReactNode }

export function PrimaryButton({ loading, icon, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function SecondaryButton({ loading, icon, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-400 hover:text-black disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

const NOTICE_TONES = {
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
} as const

export function Notice({ tone, children, action }: { tone: keyof typeof NOTICE_TONES; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm shadow-sm ${NOTICE_TONES[tone]}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-gray-500">
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-[#e5e3df] bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-black focus:outline-none disabled:bg-gray-50 disabled:text-gray-500'
