'use client'

import { useCallback, useMemo, useState } from 'react'
import { BUILT_IN_VARIABLES, mediaMarketFromCountry, validateMediaContent } from '@/lib/commercial-presentations'
import type { MediaMasterContent, PresentationMasterContentRow } from '@/types'
import { Card, CardHeader, FieldLabel, inputClass } from '../ui'
import { SectionsEditor, SectionsPreview } from './SectionsEditor'
import { MasterSaveBar, MasterVersionHistory, useMasterContent } from './MasterContent'

// A publication's Media Master Content (brief §9): its approved script, in
// titled sections of SAY / ACTION / NOTE lines (replacing the structure's
// media block), and its Media Market, which defaults to the publication's
// country in the central Media Library. Admin-only: normal users can never
// change master content (§20). Agency profiles have their own editor
// (AgencyProfileEditor), organised in sections.

const parse = (c: unknown): MediaMasterContent => validateMediaContent(c)

const SAMPLE_VARS: Record<string, string> = {
  AGENCY: 'The Report Company',
  COUNTRY: 'Kazakhstan',
  'ANCHOR EVENT': 'the G20 Summit in Miami',
  'RELEVANT DATE': 'November 2026',
}

export default function ScriptEditor({
  refId,
  entityName,
  libraryCountry,
  initialRow,
}: {
  refId: string
  entityName: string
  /** The publication's country in the Media Library ('' when not set). */
  libraryCountry: string
  initialRow: PresentationMasterContentRow | null
}) {
  // Prefilled from the Media Library country when the script has none yet.
  const defaultMarket = mediaMarketFromCountry(libraryCountry)
  const initial = parse(initialRow?.content)
  const m = useMasterContent<MediaMasterContent>({
    kind: 'media',
    refId,
    initialRow,
    initialValue: { ...initial, mediaMarket: initial.mediaMarket || defaultMarket },
    parse,
  })
  const [labels, setLabels] = useState<string[]>([])
  const onLabels = useCallback((l: string[]) => setLabels(l), [])
  const variables = BUILT_IN_VARIABLES.map((v) => v.key).filter((k) => k !== 'WHY NOW')
  const sampleVars = useMemo(
    () => ({ ...SAMPLE_VARS, MEDIA: entityName, 'MEDIA MARKET': m.value.mediaMarket || defaultMarket }),
    [entityName, m.value.mediaMarket, defaultMarket],
  )

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Media Market"
          description={`Written as it should be spoken, e.g. “the US”, “Germany”, “the UK”. Used by [MEDIA MARKET] and by the Why Now prompt. ${
            libraryCountry
              ? `Defaults to this publication's country in the Media Library (${libraryCountry}); left empty, that country is used.`
              : 'This publication has no country in the Media Library, so it stays blank unless you fill it in.'
          }`}
        />
        <div className="max-w-sm">
          <FieldLabel htmlFor="media-market">Media Market</FieldLabel>
          <input
            id="media-market"
            className={inputClass}
            value={m.value.mediaMarket}
            placeholder={defaultMarket || 'e.g. the US'}
            onChange={(e) => m.setValue({ ...m.value, mediaMarket: e.target.value })}
          />
        </div>
      </Card>
      <p className="max-w-3xl text-sm text-gray-500">
        {entityName}&apos;s approved script, in sections of SAY / ACTION / NOTE lines, with the materials to show. When
        this media is selected it replaces the structure&apos;s media block entirely, word for word with each
        project&apos;s variables filled in. Use only approved figures; the AI never edits this.
      </p>

      <SectionsEditor
        sections={m.value.sections}
        onChange={(sections) => m.setValue({ ...m.value, sections })}
        variables={variables}
        titlePlaceholder="e.g. Audience and reach"
      />

      <SectionsPreview
        sections={m.value.sections}
        sampleVars={sampleVars}
        source="media"
        description={`With sample values: The Report Company, Kazakhstan${m.value.mediaMarket ? `, ${m.value.mediaMarket}` : ''}.`}
      />
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
