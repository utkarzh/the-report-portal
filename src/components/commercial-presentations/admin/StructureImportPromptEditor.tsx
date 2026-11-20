'use client'

import { useCallback, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  DEFAULT_STRUCTURE_IMPORT_PROMPT,
  validateStructureImportPrompt,
} from '@/lib/commercial-presentations-structure-import'
import type { PresentationMasterContentRow } from '@/types'
import { Card, CardHeader, SecondaryButton, inputClass } from '../ui'
import { MasterSaveBar, MasterVersionHistory, useMasterContent } from './MasterContent'

// The instructions Claude follows to read an uploaded document into the
// presentation structure. Editable and versioned like all master content;
// with nothing saved the built-in default is used. The output format (blocks,
// SAY / ACTION / NOTE lines, manual fields) is fixed in code, so an edit here
// changes how the document is read, never what shape comes back.

type Value = { prompt: string }

// An empty saved prompt means "use the default", so the editor shows the
// default text in that case.
const parse = (c: unknown): Value => {
  const v = validateStructureImportPrompt(c)
  return { prompt: v.prompt.trim() ? v.prompt : DEFAULT_STRUCTURE_IMPORT_PROMPT }
}

export default function StructureImportPromptEditor({ initialRow }: { initialRow: PresentationMasterContentRow | null }) {
  const m = useMasterContent<Value>({ kind: 'structure_import_prompt', initialRow, initialValue: parse(initialRow?.content), parse })
  const [labels, setLabels] = useState<string[]>([])
  const onLabels = useCallback((l: string[]) => setLabels(l), [])
  const isDefault = m.value.prompt.trim() === DEFAULT_STRUCTURE_IMPORT_PROMPT.trim()

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Instructions"
          description="What Claude is told when an admin uploads a document under Structure & locked methodology → Build from a document: how to split it into blocks, what counts as SAY / ACTION / NOTE, which names become variables. The answer's format is fixed by the system, so you can't break the import from here."
          action={
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                isDefault ? 'bg-[#f0efec] text-gray-600' : 'bg-[#fbf7ed] text-[#a07530]'
              }`}
            >
              {isDefault ? 'Built-in default' : 'Customised'}
            </span>
          }
        />
        <textarea
          aria-label="Structure import instructions"
          rows={28}
          className={`${inputClass} font-mono text-xs leading-5`}
          value={m.value.prompt}
          onChange={(e) => m.setValue({ prompt: e.target.value })}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SecondaryButton icon={<RotateCcw size={13} />} disabled={isDefault} onClick={() => m.setValue({ prompt: DEFAULT_STRUCTURE_IMPORT_PROMPT })}>
            Reset to the built-in default
          </SecondaryButton>
          <span className="text-[11px] text-gray-500">Puts the original instructions back in the editor. Press Save to use them.</span>
        </div>
      </Card>
      <MasterVersionHistory master={m} onLabels={onLabels} summarize={(c) => parse(c).prompt.slice(0, 200)} />
      <MasterSaveBar liveVersion={m.row?.version_label ?? null} versionLabels={labels} dirty={m.dirty} saving={m.saving} error={m.error} onSave={m.save} isNew={!m.row} />
    </div>
  )
}
