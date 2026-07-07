'use client'

import { useEffect, useState } from 'react'
import {
  AudioLines,
  BrainCircuit,
  FileText,
  Headphones,
  Mic,
  Plus,
  Sparkles,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import Button from '@/components/ui/Button'

interface TranscriptItem {
  id: string
  title: string
  createdAt: string
  duration: string
  audioLabel: string
  summary: string
  content: string
}

const sampleTranscript = `In our latest conversation, the founder described a shift from a purely product-led approach toward a more deliberate editorial strategy. He emphasized that the company now views trust, clarity, and consistency as core differentiators in a crowded market. According to him, this change was driven by growing expectations from both readers and commercial partners, who want content that feels both timely and credible.

He also shared that the team has been investing more heavily in research infrastructure, especially around audience signals and interview preparation. The goal is not just to publish more material, but to publish material that is sharper, better sourced, and more useful to decision-makers. He framed this as a long-term investment in the publication's editorial reputation rather than a short-term growth tactic.

When asked about challenges, he pointed to the balance between speed and depth. The editorial operation is under pressure to respond quickly, but leadership wants to avoid sacrificing nuance or accuracy. That tension, he suggested, is now a defining feature of the business and one that the team is learning to manage more deliberately.`

const sampleTranscripts: TranscriptItem[] = [
  {
    id: '1',
    title: 'Founder interview — editorial strategy',
    createdAt: '14 Jun 2026',
    duration: '42 min',
    audioLabel: 'founder-interview-01.mp3',
    summary: 'A wide-ranging discussion around editorial priorities and audience trust.',
    content: sampleTranscript,
  },
  {
    id: '2',
    title: 'Product leadership roundtable',
    createdAt: '10 Jun 2026',
    duration: '27 min',
    audioLabel: 'product-roundtable.mp3',
    summary: 'Notes from a leadership conversation on product pacing and newsroom workflows.',
    content: sampleTranscript.replace('editorial strategy', 'product pacing').replace('publication', 'newsroom'),
  },
  {
    id: '3',
    title: 'Investor briefing prep',
    createdAt: '03 Jun 2026',
    duration: '19 min',
    audioLabel: 'investor-briefing.wav',
    summary: 'A prep session focused on positioning, messaging, and firm updates.',
    content: sampleTranscript.replace('founder', 'investor relations lead').replace('publication', 'firm'),
  },
]

const adminPrompt = `Admin-managed prompt guidelines:

- Preserve intent and key facts.
- Improve clarity, flow, and readability.
- Convert fragmented notes into a polished editorial draft.
- Keep a professional tone and remove repetition.
- Highlight the most important strategic takeaways.`

export function TranscriptionsDemo() {
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [transcriptionProgress, setTranscriptionProgress] = useState(0)
  const [typedText, setTypedText] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const [isRefining, setIsRefining] = useState(false)
  const [refinedText, setRefinedText] = useState('')
  const [selectedTranscript, setSelectedTranscript] = useState<TranscriptItem | null>(sampleTranscripts[0])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [transcripts, setTranscripts] = useState(sampleTranscripts)

  useEffect(() => {
    if (!isUploading && !isTranscribing) return

    const interval = window.setInterval(() => {
      setTranscriptionProgress((prev) => {
        if (prev >= 92) return prev
        return prev + 8
      })
    }, 220)

    return () => window.clearInterval(interval)
  }, [isUploading, isTranscribing])

  useEffect(() => {
    if (!isTyping) return
    if (typedText.length >= sampleTranscript.length) {
      setIsTyping(false)
      return
    }

    const timeout = window.setTimeout(() => {
      setTypedText((prev) => sampleTranscript.slice(0, prev.length + 1))
    }, 18)

    return () => window.clearTimeout(timeout)
  }, [isTyping, typedText])

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setSelectedFileName(file.name)
    setTypedText('')
    setRefinedText('')
    setIsUploading(true)
    setIsTranscribing(false)
    setTranscriptionProgress(0)

    window.setTimeout(() => {
      setIsUploading(false)
      setIsTranscribing(true)
      setTranscriptionProgress(10)
    }, 700)

    window.setTimeout(() => {
      setIsTranscribing(false)
      setTranscriptionProgress(100)
      setIsTyping(true)
    }, 2400)
  }

  const handleRefine = () => {
    if (!typedText) return

    setIsRefining(true)

    window.setTimeout(() => {
      const refined = typedText
        .split('\n\n')
        .map((paragraph, index) => `${index + 1}. ${paragraph.trim()}`)
        .join('\n\n')

      setRefinedText(`Refined editorial draft:\n\n${refined}\n\nThis version is cleaner, tighter, and more publication-ready.`)
      setIsRefining(false)
    }, 1000)
  }

  const openTranscript = (item: TranscriptItem) => {
    setSelectedTranscript(item)
    setIsModalOpen(true)
  }

  return (
    <div className="min-h-full bg-[#f0efec] p-6 md:p-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl border border-[#e5e3df] bg-[#f7f6f3] p-3 text-gray-700">
                <AudioLines size={18} />
              </div>
              <div>
                <h1 className="text-base font-semibold text-gray-900">Transcriptions</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Review saved transcripts, create a new one, and refine the result with AI.
                </p>
              </div>
            </div>

            <Button
              variant="primary"
              size="sm"
              className="w-auto"
              onClick={() => {
                setSelectedFileName(null)
                setTypedText('')
                setRefinedText('')
                setTranscriptionProgress(0)
                setIsUploading(false)
                setIsTranscribing(false)
                setIsTyping(false)
              }}
            >
              <span className="flex items-center gap-2">
                <Plus size={14} />
                New Transcription
              </span>
            </Button>
          </div>

          <div className="mt-6 rounded-xl border border-[#e5e3df] bg-[#fcfbf8] p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">Admin tools</p>
                <p className="mt-1 text-sm text-gray-600">Manage the prompt used for Claude refinement after transcription.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" className="w-auto" onClick={() => setShowPrompt((value) => !value)}>
                  <span className="flex items-center gap-2">
                    <BrainCircuit size={14} />
                    Manage Prompt
                  </span>
                </Button>
              </div>
            </div>

            {showPrompt && (
              <div className="mt-4 rounded-xl border border-[#e5e3df] bg-white p-4 text-sm leading-7 text-gray-600 whitespace-pre-line">
                {adminPrompt}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">New transcript</p>
                <h2 className="mt-1 text-sm font-semibold text-gray-900">Upload audio and begin a transcription</h2>
              </div>
              <div className="rounded-full bg-[#f7f6f3] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-gray-500">
                Demo flow
              </div>
            </div>

            <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#d4d0c8] bg-[#fcfbf8] px-6 py-10 text-center transition hover:border-gray-400">
              <div className="rounded-full bg-white p-3 text-gray-700 shadow-sm">
                <Upload size={18} />
              </div>
              <p className="mt-4 text-sm font-medium text-gray-900">Drop or select an audio file</p>
              <p className="mt-1 text-sm text-gray-500">This demo uses a simulated Whisper transcription flow.</p>
              <input type="file" accept="audio/*" className="sr-only" onChange={handleFileSelect} />
            </label>

            <div className="mt-4 rounded-2xl border border-[#e5e3df] bg-[#fcfbf8] p-4">
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>{selectedFileName ? `Selected: ${selectedFileName}` : 'No file chosen yet'}</span>
                <span className="text-xs uppercase tracking-[0.2em] text-gray-400">
                  {isUploading ? 'Preparing audio' : isTranscribing || isTyping ? 'Transcribing' : 'Ready'}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#efece7]">
                <div className="h-full rounded-full bg-black transition-all" style={{ width: `${transcriptionProgress}%` }} />
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-[#e5e3df] bg-[#fcfbf8] p-5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
                <Mic size={13} />
                <span>Live transcription</span>
              </div>

              <div className="mt-4 rounded-2xl border border-[#e5e3df] bg-white p-4 text-sm leading-7 text-gray-700 whitespace-pre-line min-h-[220px]">
                {isUploading || isTranscribing ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <span className="inline-block h-2 w-2 rounded-full bg-black animate-pulse" />
                    Whisper is listening and preparing the transcript...
                  </div>
                ) : isTyping ? (
                  <div>
                    {typedText}
                    <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-black" />
                  </div>
                ) : typedText ? (
                  <div>{typedText}</div>
                ) : (
                  <div className="text-gray-500">Upload an audio file and watch the transcript appear here in real time.</div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" size="sm" className="w-auto" onClick={handleRefine} disabled={!typedText || isRefining}>
                  <span className="flex items-center gap-2">
                    <WandSparkles size={14} />
                    Refine with AI
                  </span>
                </Button>
                <Button variant="secondary" size="sm" className="w-auto" onClick={() => setShowPrompt((value) => !value)}>
                  <span className="flex items-center gap-2">
                    <Sparkles size={14} />
                    Prompt
                  </span>
                </Button>
              </div>

              {refinedText && (
                <div className="mt-4 rounded-2xl border border-[#e5e3df] bg-white p-4 text-sm leading-7 text-gray-700 whitespace-pre-line">
                  {isRefining ? 'Refining your transcription with the admin prompt...' : refinedText}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">Saved transcriptions</p>
                  <h2 className="mt-1 text-sm font-semibold text-gray-900">Existing interviews</h2>
                </div>
                <div className="rounded-full bg-[#f7f6f3] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-gray-500">
                  Demo data
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {transcripts.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openTranscript(item)}
                    className="w-full rounded-2xl border border-[#e5e3df] bg-[#fcfbf8] p-4 text-left transition hover:border-gray-400 hover:bg-white"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                        <p className="mt-1 text-sm text-gray-500">{item.summary}</p>
                      </div>
                      <div className="rounded-full bg-white px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-gray-500">
                        {item.duration}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                      <span>{item.createdAt}</span>
                      <span className="font-medium text-gray-700">Open details</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
                <Headphones size={13} />
                <span>Audio workspace</span>
              </div>
              <div className="mt-4 rounded-2xl border border-[#e5e3df] bg-[#fcfbf8] p-5 text-sm text-gray-600">
                Audio playback, speaker markers, and clip review can be surfaced here once the real Whisper and storage flow is connected.
              </div>
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && selectedTranscript && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl rounded-3xl border border-[#e5e3df] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">Transcript details</p>
                <h3 className="mt-1 text-base font-semibold text-gray-900">{selectedTranscript.title}</h3>
                <p className="mt-1 text-sm text-gray-500">{selectedTranscript.createdAt} · {selectedTranscript.duration}</p>
              </div>
              <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-full border border-[#e5e3df] p-2 text-gray-500 hover:text-gray-900">
                <X size={16} />
              </button>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-2xl border border-[#e5e3df] bg-[#fcfbf8] p-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
                  <FileText size={13} />
                  <span>Audio preview</span>
                </div>
                <div className="mt-4 rounded-2xl border border-[#e5e3df] bg-white p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{selectedTranscript.audioLabel}</p>
                      <p className="mt-1 text-sm text-gray-500">Audio file preview area for the selected transcript.</p>
                    </div>
                    <button type="button" className="rounded-full bg-black p-2.5 text-white">
                      <Play size={16} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e5e3df] bg-[#fcfbf8] p-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
                  <FileText size={13} />
                  <span>Transcription</span>
                </div>
                <div className="mt-4 rounded-2xl border border-[#e5e3df] bg-white p-5 text-sm leading-7 text-gray-700 whitespace-pre-line">
                  {selectedTranscript.content}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
