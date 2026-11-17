'use client'

import { useCallback, useState } from 'react'
import { validateWhyNowConfig } from '@/lib/commercial-presentations'
import type { PresentationMasterContentRow, WhyNowConfig } from '@/types'
import { Card, CardHeader, FieldLabel, inputClass } from '../ui'
import { MasterSaveBar, MasterVersionHistory, useMasterContent } from './MasterContent'

// The Why [Country] Now prompt (brief §14) and the rules the code enforces
// on its output. The INPUTS and the OUTPUT contract are added by the code
// (so the platform does the fetching, §10, and the output can be parsed);
// [COUNTRY], [MEDIA], [MEDIA MARKET] and [AGENCY] are filled in here.

const parse = (c: unknown): WhyNowConfig => validateWhyNowConfig(c)

function NumberField({ id, label, value, onChange, hint }: { id: string; label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input id={id} type="number" className={inputClass} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="mt-1 text-[11px] text-gray-500">{hint}</p>}
    </div>
  )
}

// Keeps the raw text locally so blank lines can be typed; re-mounted (key)
// whenever the saved content changes, e.g. after a restore.
function BannedPhrases({ initial, onChange }: { initial: string[]; onChange: (phrases: string[]) => void }) {
  const [text, setText] = useState(initial.join('\n'))
  return (
    <div className="mt-4">
      <FieldLabel htmlFor="banned">Banned phrases (one per line)</FieldLabel>
      <textarea
        id="banned"
        rows={5}
        className={inputClass}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))
        }}
      />
    </div>
  )
}

export default function WhyNowPromptEditor({ initialRow }: { initialRow: PresentationMasterContentRow | null }) {
  const m = useMasterContent<WhyNowConfig>({ kind: 'why_now_prompt', initialRow, initialValue: parse(initialRow?.content), parse })
  const [labels, setLabels] = useState<string[]>([])
  const onLabels = useCallback((l: string[]) => setLabels(l), [])
  const v = m.value
  const set = (patch: Partial<WhyNowConfig>) => m.setValue({ ...v, ...patch })
  const seconds = (w: number) => Math.round((w / Math.max(1, v.wordsPerMinute)) * 60)

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Prompt"
          description="Role, objective, how to choose the angle, writing rules and factual discipline. Variables: [COUNTRY], [MEDIA], [MEDIA MARKET], [AGENCY]. The project sources and the output format are added automatically after this text."
        />
        <textarea aria-label="Why Now prompt" rows={24} className={`${inputClass} font-mono text-xs`} value={v.prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </Card>
      <Card>
        <CardHeader title="Rules checked in code" description="After each generation the text is checked against these; if it fails, the AI gets one automatic chance to fix it." />
        <div className="grid gap-4 md:grid-cols-3">
          <NumberField id="min-words" label="Minimum words" value={v.minWords} onChange={(n) => set({ minWords: n })} hint={`≈ ${seconds(v.minWords)} seconds`} />
          <NumberField id="max-words" label="Maximum words" value={v.maxWords} onChange={(n) => set({ maxWords: n })} hint={`≈ ${seconds(v.maxWords)} seconds`} />
          <NumberField id="wpm" label="Speaking pace (words per minute)" value={v.wordsPerMinute} onChange={(n) => set({ wordsPerMinute: n })} />
          <NumberField id="searches" label="Max web searches" value={v.maxWebSearches} onChange={(n) => set({ maxWebSearches: n })} hint="Only when “Check for recent developments” is ticked." />
          <NumberField id="examples" label="Reference examples per run" value={v.referenceExamplesLimit} onChange={(n) => set({ referenceExamplesLimit: n })} hint="A varied set, one per project type first." />
          <NumberField id="brief-chars" label="Editorial Brief excerpt (characters)" value={v.briefChars} onChange={(n) => set({ briefChars: n })} />
          <NumberField id="letter-chars" label="Interview Letter excerpt (characters)" value={v.letterChars} onChange={(n) => set({ letterChars: n })} />
        </div>
        <BannedPhrases key={m.historyKey} initial={v.bannedPhrases} onChange={(bannedPhrases) => set({ bannedPhrases })} />
      </Card>
      <MasterVersionHistory master={m}
        onLabels={onLabels} summarize={(c) => parse(c).prompt.slice(0, 200)} />
      <MasterSaveBar liveVersion={m.row?.version_label ?? null} versionLabels={labels} dirty={m.dirty} saving={m.saving} error={m.error} onSave={m.save} isNew={!m.row} />
    </div>
  )
}
