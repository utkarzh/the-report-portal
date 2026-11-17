'use client'

import { useCallback, useMemo, useState } from 'react'
import { BUILT_IN_VARIABLES, validateAgencyContent } from '@/lib/commercial-presentations'
import type { AgencyMasterContent, PresentationMasterContentRow } from '@/types'
import { SectionsEditor, SectionsPreview } from './SectionsEditor'
import { MasterSaveBar, MasterVersionHistory, useMasterContent } from './MasterContent'

// An agency profile (brief §8): the agency's approved master content, in titled
// sections of SAY / ACTION / NOTE lines, filled word for word with the
// project's variables into the structure's agency block; the AI never
// rewrites it. Admin-only, versioned.

const parse = (c: unknown): AgencyMasterContent => validateAgencyContent(c)

const SAMPLE_VARS: Record<string, string> = {
  MEDIA: 'USA Today',
  COUNTRY: 'Kazakhstan',
  'MEDIA MARKET': 'the United States',
  'ANCHOR EVENT': 'the G20 Summit in Miami',
  'RELEVANT DATE': 'November 2026',
}

export default function AgencyProfileEditor({
  agencyId,
  agencyName,
  initialRow,
}: {
  agencyId: string
  agencyName: string
  initialRow: PresentationMasterContentRow | null
}) {
  const m = useMasterContent<AgencyMasterContent>({ kind: 'agency', refId: agencyId, initialRow, initialValue: parse(initialRow?.content), parse })
  const [labels, setLabels] = useState<string[]>([])
  const onLabels = useCallback((l: string[]) => setLabels(l), [])
  const variables = BUILT_IN_VARIABLES.map((v) => v.key).filter((k) => k !== 'WHY NOW')
  const sampleVars = useMemo(() => ({ ...SAMPLE_VARS, AGENCY: agencyName }), [agencyName])

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-gray-500">
        {agencyName}&apos;s approved master content, in sections of SAY / ACTION / NOTE lines, with variables. The
        presentation uses it word for word with each project&apos;s variables filled in; the AI never rewrites it.
      </p>

      <SectionsEditor
        sections={m.value.sections}
        onChange={(sections) => m.setValue({ sections })}
        variables={variables}
        titlePlaceholder="e.g. Introducing the agency"
      />

      <SectionsPreview sections={m.value.sections} sampleVars={sampleVars} source="agency" description="With sample values: USA Today, Kazakhstan." />

      <MasterVersionHistory
        master={m}
        onLabels={onLabels}
        summarize={(c) => {
          const p = parse(c)
          return p.sections.length ? p.sections.map((s) => s.title || '(untitled)').join(' · ') : '(empty)'
        }}
      />
      <MasterSaveBar liveVersion={m.row?.version_label ?? null} versionLabels={labels} dirty={m.dirty} saving={m.saving} error={m.error} onSave={m.save} isNew={!m.row} />
    </div>
  )
}
