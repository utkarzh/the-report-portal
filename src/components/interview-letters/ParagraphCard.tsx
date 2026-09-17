'use client'

import { useState } from 'react'
import { Lock, RotateCcw, Check, Loader2 } from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
import { wordCount } from '@/lib/interview-letters'
import type { InterviewLetterParagraph } from '@/types'

interface Props {
  paragraph: InterviewLetterParagraph
  disabled: boolean
  onApprove: () => Promise<void>
  onRegenerate: (feedback: string) => Promise<void>
}

export default function ParagraphCard({ paragraph, disabled, onApprove, onRegenerate }: Props) {
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)
  const [approving, setApproving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  const isFixed = paragraph.type === 'fixed'
  const isLocked = paragraph.status === 'locked'
  const words = wordCount(paragraph.content)
  const overBudget = !isFixed && paragraph.wordBudget ? words > paragraph.wordBudget : false

  async function handleApprove() {
    setApproving(true)
    await onApprove()
    setApproving(false)
  }

  async function handleRegenerate() {
    setRegenerating(true)
    await onRegenerate(feedback)
    setRegenerating(false)
    setFeedback('')
    setShowFeedback(false)
  }

  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm transition-colors sm:p-5 ${
        isFixed ? 'border-[#e5e3df] bg-[#faf9f7]' : isLocked ? 'border-emerald-200 bg-emerald-50/40' : 'border-[#e5e3df] bg-white'
      }`}
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{paragraph.label}</span>
          {isFixed && (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
              Fixed
            </span>
          )}
          {!isFixed && isLocked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              <Lock size={9} /> Locked
            </span>
          )}
        </div>
        {!isFixed && (
          <span className={`text-xs ${overBudget ? 'font-medium text-red-500' : 'text-gray-400'}`}>
            {words} / {paragraph.wordBudget || 80} words
          </span>
        )}
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{paragraph.content}</p>

      {!isFixed && !isLocked && (
        <div className="mt-4 flex flex-col gap-3 border-t border-[#e5e3df] pt-4">
          {showFeedback && (
            <Textarea
              label="Feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What should change? (optional)"
              rows={2}
            />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApprove}
              disabled={disabled || regenerating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {approving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Approve
            </button>
            {showFeedback ? (
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={disabled || approving || regenerating}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-black disabled:opacity-50"
              >
                <RotateCcw size={12} className={regenerating ? 'animate-spin' : ''} />
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowFeedback(true)}
                disabled={disabled || approving}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-black disabled:opacity-50"
              >
                <RotateCcw size={12} /> Regenerate
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
