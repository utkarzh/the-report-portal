'use client'

import { useState } from 'react'
import { Lock, RotateCcw } from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
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
    <div className={`bg-white border ${isFixed ? 'border-[#e5e3df] bg-[#faf9f7]' : isLocked ? 'border-emerald-200' : 'border-[#e5e3df]'} p-4 sm:p-5`}>
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{paragraph.label}</span>
          {isFixed && (
            <span className="text-[9px] font-semibold uppercase tracking-wider bg-gray-200 text-gray-600 px-1.5 py-0.5">
              Fixed
            </span>
          )}
          {!isFixed && isLocked && (
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-700 px-1.5 py-0.5">
              <Lock size={9} /> Locked
            </span>
          )}
        </div>
        {!isFixed && (
          <span className={`text-xs ${overBudget ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
            {words} / {paragraph.wordBudget || 80} words
          </span>
        )}
      </div>

      <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{paragraph.content}</p>

      {!isFixed && !isLocked && (
        <div className="mt-4 pt-4 border-t border-[#e5e3df] flex flex-col gap-3">
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
            <Button type="button" onClick={handleApprove} loading={approving} disabled={disabled || regenerating} size="sm">
              Approve
            </Button>
            {showFeedback ? (
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={disabled || approving || regenerating}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-black transition-colors disabled:opacity-50"
              >
                <RotateCcw size={12} className={regenerating ? 'animate-spin' : ''} />
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowFeedback(true)}
                disabled={disabled || approving}
                className="text-xs font-medium text-gray-500 hover:text-black transition-colors disabled:opacity-50"
              >
                Regenerate
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
