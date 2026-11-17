import React from 'react'
import { Document, Page, View, Text, Image, Svg, Line, Path, Circle, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { marked, type Token, type Tokens } from 'marked'
// Importing BODY_FONT registers the embedded Tinos font (and the hyphenation
// callback) once per lambda, as for every other PDF export.
import { BODY_FONT } from '@/lib/download-templates/pdf'
import { scoreBand, type ScoreBandTone } from '@/lib/sales-coach'
import { PATTERN_SCOPES, type PatternCardSummary, type PatternStats } from '@/lib/sales-coach-patterns'
import { TRC_WORDMARK_PNG_BASE64 } from '@/lib/trc-wordmark'

// The Sales Coach Pattern Analysis as a PDF (17 Nov 2026), laid out like the
// page at /commercial/admin/sales-coach/patterns: a dark cover band with the
// wordmark; the Snapshot counted in code (tiles, the score line, each
// criterion's bar); the AI analysis exactly as saved; the Report Cards it read.
// Built from a SAVED analysis (its stored stats and text), so the PDF always
// matches what was analysed and costs nothing to download.
//
// @react-pdf traps (see the Country Intelligence notes in CLAUDE.md): no
// lineHeight on the Page style, and the embedded Tinos subset has no ✓/⚠.
// Helvetica (the built-in sans) has no →, so withArrow() prints that glyph in
// Tinos.

export interface PatternPdfInput {
  subjectName: string
  scope: string
  cardCount: number
  periodStart: string | null
  periodEnd: string | null
  analysedAt: string
  stats: PatternStats
  cards: PatternCardSummary[] // newest first
  output: string
}

const C = {
  ink: '#1c1917', body: '#44403c', muted: '#78716c', faint: '#a8a29e', hair: '#ece8e1', tile: '#faf8f5',
  gold: '#a07530', goldDeep: '#8f6626', goldLight: '#e6cf9c', night: '#12141c',
  strong: '#10b981', partial: '#fbbf24', weak: '#f43f5e', uv: '#38bdf8', na: '#d6d3d1', retorno: '#0ea5e9',
  up: '#047857', down: '#be123c',
}
const BAND_RING: Record<ScoreBandTone, string> = { strong: '#059669', solid: '#d97706', growth: '#dc2626' }
const SANS = 'Helvetica'
const SANS_B = 'Helvetica-Bold'
const MX = 44
const CW = 595 - MX * 2

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
function periodLabel(a: string | null, b: string | null): string {
  if (!a || !b) return '—'
  return a.slice(0, 10) === b.slice(0, 10) ? longDate(a) : `${shortDate(a)} – ${longDate(b)}`
}

const withArrow = (str: string): React.ReactNode[] =>
  str.split('→').flatMap((part, i) => (i ? [<Text key={`a${i}`} style={{ fontFamily: BODY_FONT }}>→</Text>, part] : [part]))

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: MX, fontFamily: BODY_FONT, fontSize: 10.5, color: C.body },
  kicker: { fontFamily: SANS_B, fontSize: 7.5, letterSpacing: 1.4, color: C.muted, textTransform: 'uppercase' },
  kickerGold: { fontFamily: SANS_B, fontSize: 7.5, letterSpacing: 1.5, color: C.goldDeep, textTransform: 'uppercase' },
  card: { borderWidth: 0.75, borderColor: '#e6e2da', borderRadius: 10, backgroundColor: '#ffffff', padding: 16 },
  h2: { fontFamily: SANS_B, fontSize: 11, color: C.ink },
  note: { fontFamily: SANS, fontSize: 7.5, color: C.faint, lineHeight: 1.35 },
  tile: { flex: 1, backgroundColor: C.tile, borderWidth: 0.5, borderColor: C.hair, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 },
  tileLabel: { fontFamily: SANS, fontSize: 7.5, color: C.muted },
  tileSub: { marginTop: 3, fontFamily: SANS, fontSize: 7.5, color: C.muted, lineHeight: 1.3 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  para: { fontSize: 10.5, lineHeight: 1.45, color: C.body, marginBottom: 7 },
  footer: { position: 'absolute', bottom: 24, left: MX, right: MX, flexDirection: 'row', justifyContent: 'space-between', fontFamily: SANS, fontSize: 7.5, color: C.faint },
})

function scopeValue(scope: string, count: number): string {
  if (scope === 'all') return `All ${count}`
  return PATTERN_SCOPES.some((p) => p.id === scope) ? `Last ${count}` : String(count)
}

// ── Cover band (dark, so the white wordmark sits on a dark surface) ───────
function Cover({ d }: { d: PatternPdfInput }) {
  const first = d.subjectName.split(/\s+/)[0] || d.subjectName
  const facts: [string, string][] = [
    ['Report Cards', scopeValue(d.scope, d.cardCount)],
    ['Period', periodLabel(d.periodStart, d.periodEnd)],
    ['Analysed', longDate(d.analysedAt)],
    ['Prepared for', 'TRC management · confidential'],
  ]
  return (
    <View style={{ backgroundColor: C.night, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
      <View style={{ height: 3, backgroundColor: C.gold }} />
      <View style={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image has no alt */}
          <Image src={`data:image/png;base64,${TRC_WORDMARK_PNG_BASE64}`} style={{ width: 150, height: 21 }} />
          <Text style={{ fontFamily: SANS_B, fontSize: 7.5, letterSpacing: 1.5, color: C.goldLight, textTransform: 'uppercase' }}>Sales Coach · Pattern Analysis</Text>
        </View>
        <Text style={{ marginTop: 22, fontFamily: BODY_FONT, fontWeight: 700, fontSize: 26, color: '#ffffff' }}>{d.subjectName}</Text>
        <Text style={{ marginTop: 5, fontFamily: BODY_FONT, fontSize: 13, color: '#d6d3d1' }}>What keeps happening across {first}&apos;s negotiations</Text>
        <View style={{ marginTop: 14, flexDirection: 'row', gap: 16 }}>
          {facts.map(([k, v]) => (
            <View key={k}>
              <Text style={{ fontFamily: SANS_B, fontSize: 6.5, letterSpacing: 1.2, color: '#a8a29e', textTransform: 'uppercase' }}>{k}</Text>
              <Text style={{ marginTop: 2.5, fontFamily: SANS, fontSize: 9, color: '#f5f5f4' }}>{v}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}

// ── Snapshot (counted in code, no AI) ─────────────────────────────────────
function Tile({ label, value, sub, valueColor }: { label: string; value: string; sub: React.ReactNode; valueColor?: string }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={{ marginTop: 3, fontFamily: SANS_B, fontSize: 19, color: valueColor || C.ink }}>{value}</Text>
      {typeof sub === 'string' ? <Text style={s.tileSub}>{withArrow(sub)}</Text> : sub}
    </View>
  )
}

const OUTCOMES: { key: keyof PatternStats['outcomes']; label: string; dot: string }[] = [
  { key: 'signed', label: 'Signed', dot: C.strong },
  { key: 'retorno', label: 'Follow-up (retorno)', dot: C.retorno },
  { key: 'lost', label: 'Lost', dot: C.weak },
  { key: 'uncertain', label: 'Uncertain', dot: C.faint },
]

function Snapshot({ d }: { d: PatternPdfInput }) {
  const { stats } = d
  const band = scoreBand(stats.averagePct)
  const delta = stats.earlierAvg !== null && stats.laterAvg !== null ? stats.laterAvg - stats.earlierAvg : null
  const half = Math.floor(stats.scoredCount / 2)
  const period = periodLabel(stats.periodStart, stats.periodEnd)
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={s.h2}>Snapshot</Text>
        <Text style={{ fontFamily: SANS, fontSize: 7.5, color: C.muted }}>Counted from the Report Cards, no AI · {period}</Text>
      </View>
      <View style={{ marginTop: 10, flexDirection: 'row', gap: 8 }}>
        <Tile label="Report Cards" value={String(stats.count)} sub={period} />
        <Tile
          label="Average score"
          value={stats.averagePct === null ? '—' : `${stats.averagePct}%`}
          sub={band ? (
            <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={[s.dot, { backgroundColor: BAND_RING[band.tone] }]} />
              <Text style={{ fontFamily: SANS, fontSize: 7.5, color: BAND_RING[band.tone] }}>{band.label}</Text>
            </View>
          ) : 'No calculable scores'}
        />
        <Tile
          label="Trend"
          value={delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta} pts`}
          valueColor={delta === null ? C.ink : delta > 2 ? C.up : delta < -2 ? C.down : C.ink}
          sub={delta === null ? 'Needs 4+ scored cards' : `Latest ${half} vs earlier ${half}: ${stats.earlierAvg}% → ${stats.laterAvg}%`}
        />
        <View style={s.tile}>
          <Text style={s.tileLabel}>Outcomes</Text>
          {OUTCOMES.map((o) => (
            <View key={o.key} style={{ marginTop: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={[s.dot, { backgroundColor: o.dot }]} />
                <Text style={{ fontFamily: SANS, fontSize: 8, color: C.body }}>{o.label}</Text>
              </View>
              <Text style={{ fontFamily: SANS_B, fontSize: 8, color: C.ink }}>{String(stats.outcomes[o.key] ?? 0)}</Text>
            </View>
          ))}
        </View>
      </View>
      <Text style={[s.kicker, { marginTop: 16 }]}>Score, negotiation by negotiation</Text>
      <ScoreChart cards={d.cards} />
      <Text style={[s.kicker, { marginTop: 14 }]}>Each criterion across these Report Cards</Text>
      <Criteria stats={stats} />
    </View>
  )
}

function ScoreChart({ cards }: { cards: PatternCardSummary[] }) {
  const points = [...cards].sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).filter((c) => c.pct !== null) as (PatternCardSummary & { pct: number })[]
  if (points.length === 0) return <Text style={[s.note, { marginTop: 6 }]}>None of these Report Cards has a calculable score.</Text>
  const W = CW - 32, H = 128, padL = 22, padR = 8, padT = 8, padB = 8
  const x = (i: number) => (points.length === 1 ? (padL + W - padR) / 2 : padL + (i * (W - padL - padR)) / (points.length - 1))
  const y = (p: number) => padT + ((100 - p) * (H - padT - padB)) / 100
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ')
  return (
    <View style={{ marginTop: 6 }}>
      <View style={{ position: 'relative', width: W, height: H }}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          {[0, 50, 80, 100].map((t) => (
            <Line
              key={t}
              x1={padL} x2={W - padR} y1={y(t)} y2={y(t)}
              stroke={t === 0 ? '#e7e3dc' : '#efebe4'}
              strokeWidth={t === 50 || t === 80 ? 0.9 : 0.6}
              strokeDasharray={t === 50 || t === 80 ? '2,2' : undefined}
            />
          ))}
          {points.length > 1 && <Path d={d} fill="none" stroke={C.gold} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />}
          {points.map((p, i) => {
            const band = scoreBand(p.pct)
            return <Circle key={p.id} cx={x(i)} cy={y(p.pct)} r={2.8} fill={band ? BAND_RING[band.tone] : C.faint} stroke="#ffffff" strokeWidth={1} />
          })}
        </Svg>
        {[0, 50, 80, 100].map((t) => (
          <Text key={`l${t}`} style={{ position: 'absolute', left: 0, top: y(t) - 4, width: padL - 5, textAlign: 'right', fontFamily: SANS, fontSize: 6.5, color: C.faint }}>{String(t)}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: padL, width: W, marginTop: 2 }}>
        <Text style={{ fontFamily: SANS, fontSize: 7, color: C.faint }}>{shortDate(points[0].created_at)}</Text>
        {points.length > 1 && <Text style={{ fontFamily: SANS, fontSize: 7, color: C.faint }}>{shortDate(points[points.length - 1].created_at)}</Text>}
      </View>
      <Text style={[s.note, { marginTop: 3 }]}>
        Each dot is one negotiation, oldest to newest, coloured by its score band. Dashed lines at 50 and 80 mark the bands (Room to grow · Good foundation · Strong execution).
      </Text>
    </View>
  )
}

type SegmentKey = 'pass' | 'warn' | 'fail' | 'uv' | 'na'
const SEGMENTS: { key: SegmentKey; label: string; color: string }[] = [
  { key: 'pass', label: 'Strong', color: C.strong },
  { key: 'warn', label: 'Partial', color: C.partial },
  { key: 'fail', label: 'Weak', color: C.weak },
  { key: 'uv', label: 'UV (not verifiable)', color: C.uv },
  { key: 'na', label: 'N/A', color: C.na },
]

function Criteria({ stats }: { stats: PatternStats }) {
  const BAR = 180
  return (
    <View style={{ marginTop: 6 }}>
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 4 }}>
        {SEGMENTS.map((g) => (
          <View key={g.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 7, height: 4, borderRadius: 2, backgroundColor: g.color }} />
            <Text style={{ fontFamily: SANS, fontSize: 7, color: C.muted }}>{g.label}</Text>
          </View>
        ))}
      </View>
      {stats.criteria.map((c, idx) => {
        const total = c.pass + c.warn + c.fail + c.uv + c.na
        const move = c.earlierCredit !== null && c.laterCredit !== null ? c.laterCredit - c.earlierCredit : null
        const segs = SEGMENTS.filter((g) => c[g.key] > 0)
        const gaps = Math.max(segs.length - 1, 0) * 1.5
        const moveText = move === null ? (c.creditShare === null ? '' : `${c.creditShare}% credit`) : `${c.earlierCredit}% → ${c.laterCredit}%`
        return (
          <View key={c.key} wrap={false} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4.5, borderTopWidth: idx ? 0.5 : 0, borderTopColor: '#f0ede7' }}>
            <Text style={{ width: 150, fontFamily: SANS, fontSize: 8.5, color: C.ink }}>
              <Text style={{ color: C.faint }}>{`${c.number}  `}</Text>{c.label}
            </Text>
            <View style={{ width: BAR, height: 5, flexDirection: 'row', gap: 1.5 }}>
              {total === 0
                ? <View style={{ width: BAR, height: 5, borderRadius: 2.5, backgroundColor: '#f5f5f4' }} />
                : segs.map((g) => <View key={g.key} style={{ width: ((BAR - gaps) * c[g.key]) / total, height: 5, borderRadius: 2.5, backgroundColor: g.color }} />)}
            </View>
            <Text style={{ width: 66, textAlign: 'right', fontFamily: SANS, fontSize: 8, color: C.body }}>{c.applicable ? `Strong ${c.pass}/${c.applicable}` : 'Not rated'}</Text>
            <Text style={{ width: 70, marginLeft: 8, textAlign: 'right', fontFamily: SANS, fontSize: 7.5, color: move === null || Math.abs(move) < 5 ? C.muted : move > 0 ? C.up : C.down }}>
              {withArrow(moveText)}
            </Text>
          </View>
        )
      })}
      <Text style={[s.note, { marginTop: 5 }]}>
        {withArrow('"Strong 5/9": rated Strong in 5 of the 9 Report Cards where it applied. The last column is the share of available credit earned (Strong full, Partial half) in the earlier half → the more recent half of the cards; green or red marks a change of 5 points or more. Criterion 3, Commercial Outcome, is never scored.')}
      </Text>
    </View>
  )
}

// ── The AI analysis, as saved (Markdown → PDF) ────────────────────────────
const decode = (str: string) => str.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

function inline(tokens: Token[] | undefined, bold = false, italic = false): React.ReactNode[] {
  const out: React.ReactNode[] = []
  ;(tokens || []).forEach((t, i) => {
    if (t.type === 'strong') {
      out.push(<Text key={i} style={{ fontWeight: 700, color: C.ink, fontStyle: italic ? 'italic' : 'normal' }}>{inline((t as Tokens.Strong).tokens, true, italic)}</Text>)
    } else if (t.type === 'em') {
      out.push(<Text key={i} style={{ fontStyle: 'italic', fontWeight: bold ? 700 : 400 }}>{inline((t as Tokens.Em).tokens, bold, true)}</Text>)
    } else if ('tokens' in t && Array.isArray(t.tokens) && t.tokens.length) {
      out.push(...inline(t.tokens as Token[], bold, italic))
    } else {
      out.push(decode(('text' in t ? (t.text as string) : undefined) ?? t.raw ?? ''))
    }
  })
  return out
}

function Analysis({ d }: { d: PatternPdfInput }) {
  const blocks: React.ReactNode[] = []
  let first = true
  marked.lexer(d.output).forEach((t, i) => {
    if (t.type === 'heading') {
      blocks.push(
        <View key={i} wrap={false} minPresenceAhead={60} style={{ marginTop: first ? 0 : 12, marginBottom: 6 }}>
          <View style={{ width: 22, height: 2, backgroundColor: C.gold, marginBottom: 5 }} />
          <Text style={{ fontFamily: BODY_FONT, fontWeight: 700, fontSize: 14, color: C.ink }}>{decode((t as Tokens.Heading).text)}</Text>
        </View>,
      )
      first = false
    } else if (t.type === 'paragraph') {
      blocks.push(<Text key={i} style={s.para}>{inline((t as Tokens.Paragraph).tokens)}</Text>)
    } else if (t.type === 'list') {
      const list = t as Tokens.List
      list.items.forEach((item, n) => {
        const parts = item.tokens.filter((b) => b.type === 'text' || b.type === 'paragraph') as (Tokens.Text | Tokens.Paragraph)[]
        blocks.push(
          <View key={`${i}-${n}`} style={{ flexDirection: 'row', marginBottom: 5, paddingLeft: 2 }}>
            <Text style={{ width: list.ordered ? 16 : 11, fontFamily: list.ordered ? SANS_B : BODY_FONT, fontSize: list.ordered ? 9 : 10.5, color: C.gold, lineHeight: 1.45 }}>
              {list.ordered ? `${(typeof list.start === 'number' ? list.start : 1) + n}.` : '•'}
            </Text>
            <View style={{ flex: 1 }}>
              {parts.map((b, k) => (
                <Text key={k} style={[s.para, { marginBottom: k < parts.length - 1 ? 4 : 0 }]}>{inline(b.tokens ?? [{ type: 'text', raw: b.text, text: b.text } as Token])}</Text>
              ))}
            </View>
          </View>,
        )
      })
    }
    // Horizontal rules and blank space are skipped, as the page hides the rules.
  })
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <Text style={s.kickerGold}>AI pattern analysis</Text>
        <Text style={{ fontFamily: SANS, fontSize: 7.5, color: C.muted }}>
          Written by the TRC Sales Coach from these {d.cardCount} Report Card{d.cardCount === 1 ? '' : 's'}, against the TRC documents
        </Text>
      </View>
      <View style={{ height: 0.75, backgroundColor: C.goldLight, marginBottom: 14 }} />
      {blocks}
    </View>
  )
}

// ── The Report Cards read ─────────────────────────────────────────────────
const OUTCOME_LABEL: Record<string, [string, string]> = {
  signed: ['Signed', C.strong],
  retorno: ['Follow-up (retorno)', C.retorno],
  lost: ['Lost', C.weak],
  uncertain: ['Uncertain', C.faint],
}

function CardsTable({ d }: { d: PatternPdfInput }) {
  const head = { fontFamily: SANS_B, fontSize: 7, letterSpacing: 0.8, color: C.muted, textTransform: 'uppercase' as const }
  const missing = d.cardCount - d.cards.length
  return (
    <View>
      <Text style={s.h2}>Report Cards in this analysis</Text>
      <Text style={{ marginTop: 2, marginBottom: 8, fontFamily: SANS, fontSize: 7.5, color: C.muted }}>
        Newest first. A re-evaluated meeting is counted once, with its latest card.
        {missing > 0 ? ` ${missing} negotiation${missing === 1 ? ' has' : 's have'} since been deleted and ${missing === 1 ? 'is' : 'are'} not listed.` : ''}
      </Text>
      <View fixed style={{ flexDirection: 'row', paddingBottom: 4, borderBottomWidth: 0.75, borderBottomColor: '#e6e2da' }}>
        <Text style={[head, { width: 70 }]}>Date</Text>
        <Text style={[head, { width: 250 }]}>Company</Text>
        <Text style={[head, { width: 110 }]}>Outcome</Text>
        <Text style={[head, { flex: 1, textAlign: 'right' }]}>Score</Text>
      </View>
      {d.cards.map((c, i) => {
        const [label, dot] = (c.declared_outcome && OUTCOME_LABEL[c.declared_outcome]) || ['Not stated', C.faint]
        const band = scoreBand(c.pct)
        return (
          <View key={c.id} wrap={false} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#f0ede7', backgroundColor: i % 2 ? '#fcfbf9' : '#ffffff' }}>
            <Text style={{ width: 70, fontFamily: SANS, fontSize: 8, color: C.muted }}>{longDate(c.created_at)}</Text>
            <Text style={{ width: 250, fontSize: 9.5, color: C.ink }}>{c.company || 'Untitled negotiation'}</Text>
            <View style={{ width: 110, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={[s.dot, { backgroundColor: dot }]} />
              <Text style={{ fontFamily: SANS, fontSize: 8, color: C.body }}>{label}</Text>
            </View>
            <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
              {band && <View style={[s.dot, { backgroundColor: BAND_RING[band.tone] }]} />}
              <Text style={{ fontFamily: SANS_B, fontSize: 8.5, color: C.ink }}>{c.pct === null ? '—' : `${c.pct}%`}</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

function Footer({ name }: { name: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>TRC Sales Coach · Pattern Analysis · {name} · Confidential</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}

function PatternDoc({ d }: { d: PatternPdfInput }) {
  return (
    <Document title={`Pattern Analysis – ${d.subjectName}`} author="The Report Company" subject="TRC Sales Coach pattern analysis">
      <Page size="A4" style={s.page}>
        <Cover d={d} />
        <Snapshot d={d} />
        <Footer name={d.subjectName} />
      </Page>
      <Page size="A4" style={s.page}>
        <Analysis d={d} />
        <Footer name={d.subjectName} />
      </Page>
      {d.cards.length > 0 && (
        <Page size="A4" style={s.page}>
          <CardsTable d={d} />
          <Footer name={d.subjectName} />
        </Page>
      )}
    </Document>
  )
}

export async function buildPatternPdf(d: PatternPdfInput): Promise<Buffer> {
  return renderToBuffer(<PatternDoc d={d} />)
}

// "Pattern Analysis – Daniel Yustas – 17 Nov 2026"
export function patternPdfName(subjectName: string, analysedAt: string): string {
  return `Pattern Analysis – ${subjectName} – ${longDate(analysedAt)}`.replace(/[\\/:*?"<>|]+/g, ' ').trim()
}
