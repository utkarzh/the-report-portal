import React from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
// Importing BODY_FONT also registers the embedded Tinos font (Latin Extended,
// Greek, Cyrillic) — the built-in PDF fonts corrupt characters like ł, ż, €.
import { BODY_FONT } from '@/lib/download-templates/pdf'
import { confirmed, entriesOf, othersOf, revenueText, type ReportModel } from './report-data'
import type { CiCompany, CiContactEntry } from './types'

// The report in the layout of the client's "Italy Country Intelligence
// Report" sample: cover + notice, contents by sector, then one two-column field
// table per company — plus the contact block the sample lacks.

const BLUE = '#14419a'
const s = StyleSheet.create({
  // Line height is set on the rows, not on the page: a page-level
  // lineHeight breaks @react-pdf's pagination once a sector runs past a few
  // pages ("unsupported number: -7e+21"). A View needs its own fontSize for
  // a unitless lineHeight to resolve against the right size.
  page: { paddingTop: 44, paddingBottom: 46, paddingHorizontal: 46, fontFamily: BODY_FONT, fontSize: 9.2, color: '#111' },
  foot: { position: 'absolute', bottom: 22, left: 0, right: 0, textAlign: 'center', fontSize: 8, color: '#888' },
  h1: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginTop: 150, marginBottom: 10 },
  sub: { fontSize: 12, textAlign: 'center', color: '#444', marginBottom: 4 },
  notice: { marginTop: 28, marginHorizontal: 12, padding: 10, borderWidth: 0.8, borderColor: '#d9534f', backgroundColor: '#fdf0ef', color: '#7a1f1c', fontSize: 9, fontStyle: 'italic' },
  h2: { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  count: { fontSize: 10.5, color: '#444', textAlign: 'center', marginBottom: 14 },
  h3: { fontSize: 12.5, fontWeight: 'bold', color: BLUE, marginTop: 4, marginBottom: 4 },
  co: { borderBottomWidth: 0.6, borderBottomColor: '#cfcfcf', paddingBottom: 6, marginBottom: 9 },
  row: { flexDirection: 'row', paddingVertical: 1.4, fontSize: 9.2, lineHeight: 1.3 },
  label: { width: 108, fontWeight: 'bold', color: '#333', paddingRight: 6 },
  value: { flex: 1 },
  ct: { backgroundColor: '#f2f6fc', borderTopWidth: 0.8, borderBottomWidth: 0.8, borderColor: BLUE, paddingVertical: 3, paddingHorizontal: 4, marginVertical: 3 },
  ctLabel: { width: 104, fontWeight: 'bold', color: BLUE, paddingRight: 6 },
  ok: { color: '#1e7a3c', fontWeight: 'bold' },
  warn: { color: '#b06a12', fontWeight: 'bold' },
  flag: { color: '#b23a26', fontWeight: 'bold' },
  small: { fontSize: 7.8, color: '#555' },
  tocRow: { flexDirection: 'row', paddingVertical: 2.4, fontSize: 10.5 },
  tblHead: { flexDirection: 'row', borderBottomWidth: 0.9, borderBottomColor: '#111', paddingVertical: 2, fontWeight: 'bold', fontSize: 7.8 },
  tblRow: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: '#d6d6d6', paddingVertical: 2, fontSize: 7.8, lineHeight: 1.3 },
})

// The embedded Tinos subset has no ✓/⚠ glyphs (they print as blank space), so the PDF marks with √ and ?.
const Mark = ({ v }: { v?: string }) => (confirmed(v) ? <Text style={s.ok}> √</Text> : v === 'unconfirmed' ? <Text style={s.warn}> ?</Text> : null)

function Contact({ e }: { e: CiContactEntry }) {
  return (
    <View style={{ marginBottom: 2.5 }}>
      <Text>
        <Text style={{ fontWeight: 'bold' }}>{e.name}</Text>{e.kind === 'person' ? <Mark v={e.checks.name} /> : null}{e.role ? <Text>, {e.role}</Text> : null}
      </Text>
      {(e.phone || e.mobile || e.email) ? (
        <Text>
          {e.phone ? <Text>Tel. {e.phone}<Mark v={e.checks.phone} />   </Text> : null}
          {e.mobile ? <Text>Mobile {e.mobile}<Mark v={e.checks.mobile} />   </Text> : null}
          {e.email ? <Text>{e.email}<Mark v={e.checks.email} /></Text> : null}
        </Text>
      ) : null}
      {e.ask_for ? <Text style={s.small}>Ask for: {e.ask_for}</Text> : null}
    </View>
  )
}

// react-pdf only allows strings inside <Text>: a mixed `{n} of {m}` child list arrives as an array.
const inText = (c: React.ReactNode) => (React.isValidElement(c) ? c : <Text>{c}</Text>)
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <View style={s.row} wrap={false}><Text style={s.label}>{label}</Text><View style={s.value}>{inText(children)}</View></View>
)
const CtRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <View style={[s.row, { paddingVertical: 1.8 }]} wrap={false}><Text style={s.ctLabel}>{label}</Text><View style={s.value}>{inText(children)}</View></View>
)
const v = (x: string | undefined | null, d = 'unverified') => (x && x.trim() ? x : d)

function CompanyBlock({ c, no }: { c: CiCompany; no: number }) {
  const p = c.profile!
  const o = c.outreach
  const L = p.leader
  const others = othersOf(c)
  const sw = o?.switchboard
  const sources = [...p.sources.map((x) => x.url), ...(p.grounded_sources || []).map((x) => x.url)].filter((u, i, a) => u && a.indexOf(u) === i).slice(0, 6)
  const leaderText = [p.leader.trajectory, p.leader.public_statements ? `On record: ${p.leader.public_statements}` : '', p.leader.interview_hooks ? `Interview angle: ${p.leader.interview_hooks}` : ''].filter(Boolean).join(' ')
  return (
    <View style={s.co}>
      <Text style={s.h3} minPresenceAhead={80}>{no}. {p.name || c.name}</Text>
      <Row label="Website">{v(p.website)}</Row>
      <Row label="Sector">{`${c.sector || 'Other'}${p.subsector ? ` — ${p.subsector}` : ''}`}</Row>
      <Row label="Headquarters">{v(p.headquarters)}</Row>
      <Row label="CEO or principal decision-maker">{`${v(L.name)}${L.title ? `, ${L.title}` : ''}${L.since ? ` (since ${L.since})` : ''}`}</Row>
      <Row label="Leader trajectory">{v(leaderText)}</Row>
      <View style={s.ct}>
        <CtRow label="Who to approach">{o?.primary ? <Contact e={o.primary} /> : <Text>No published contact found — use the website contact form.</Text>}</CtRow>
        {others.length ? <CtRow label="Other contacts"><View>{others.map((e, i) => <Contact key={i} e={e} />)}</View></CtRow> : null}
        {sw ? <CtRow label="Switchboard & head office"><Text>{[sw.phone ? `Tel. ${sw.phone}` : '', sw.email].filter(Boolean).join('   ')}{sw.address ? `\n${sw.address}` : ''}</Text></CtRow> : null}
        {o?.approach ? <CtRow label="Suggested approach">{o.approach}</CtRow> : null}
      </View>
      <Row label="Ownership"><Text>{v(p.ownership)}{p.foreign_parent ? <Text style={s.flag}>  Foreign parent: {p.foreign_parent}</Text> : null}</Text></Row>
      <Row label="Revenue">{revenueText(c)}</Row>
      <Row label="Alternative scale indicators">{p.scale_indicators.join('; ') || 'N/A'}</Row>
      <Row label="International operations">{v(p.international_operations)}</Row>
      <Row label="Sector ranking">{v(p.sector_ranking)}</Row>
      <Row label="Recent developments">{p.recent_developments.map((d) => `${d.date ? d.date + ': ' : ''}${d.text}`).join('\n') || 'unverified'}</Row>
      <Row label="Government connection">{v(p.government_connection, 'None identified')}</Row>
      <Row label="Relevance to the report">{v(p.theme_relevance)}</Row>
      <Row label="Global / international relevance">{v(p.cross_border_links)}</Row>
      <Row label="Commercial qualification"><Text>{c.verdict?.pass ? c.verdict.label : <Text style={s.flag}>Outside the criteria</Text>} — {c.verdict?.reason}</Text></Row>
      <Row label="Reason for inclusion">{v(p.reason_for_inclusion)}</Row>
      <Row label="List status">{c.origin === 'client' ? 'Client list' : 'New find (not on the client list)'}</Row>
      <Row label="Sources"><Text style={s.small}>{sources.join('\n') || 'unverified'}</Text></Row>
    </View>
  )
}

const Foot = () => <Text style={s.foot} fixed render={({ pageNumber }) => `${pageNumber}`} />

function ReportDoc({ m }: { m: ReportModel }) {
  const p = m.project
  const date = new Date().toISOString().slice(0, 10)
  const minRev = `USD ${Math.round(Number(p.min_revenue_usd) / 1e6)} million`
  const ctx = m.context
  const dir = m.sections.flatMap((sec) => sec.companies.flatMap((c) => entriesOf(c).filter((e) => e.phone || e.mobile || e.email).map((e) => ({ c, e }))))
  return (
    <Document title={`${p.country} Country Intelligence Report`}>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>{p.country} Country Intelligence Report</Text>
        <Text style={s.sub}>Companies &amp; Leader Research — Commercial and Editorial Opportunity Pipeline</Text>
        {p.brief ? <Text style={s.sub}>{p.brief}</Text> : null}
        <Text style={s.sub}>Generated {date} · {m.total} companies across {m.sections.length} sectors</Text>
        <Text style={[s.sub, { fontSize: 10, marginTop: 8, marginHorizontal: 30 }]}>Every listed company meets the selection criteria: {p.local_hq_only ? `headquartered and owned in ${p.country}, ` : ''}an established company, and {minRev}+ annual revenue (or, where revenue is unpublished, strong scale evidence).</Text>
        <Text style={s.notice}>Research run notice: produced by the Country Intelligence module of the Editorial Tool, calling the Gemini API with live Google Search grounding. Figures marked "unverified" have not been independently confirmed beyond the cited source. Contact details marked √ were found on the company&apos;s own pages by an automatic check; ? means reported by the research but not confirmed automatically. Verify before commercial or editorial use.</Text>
      </Page>

      <Page size="A4" style={s.page}>
        <Text style={s.h2}>Contents</Text>
        {m.sections.map((sec) => <View key={sec.sector} style={s.tocRow}><Text style={{ flex: 1 }}>{sec.sector}</Text><Text>— {sec.companies.length} companies</Text></View>)}
        <View style={[s.tocRow, { borderTopWidth: 0.8, marginTop: 4, paddingTop: 4, fontWeight: 'bold' }]}><Text style={{ flex: 1 }}>Total meeting the criteria</Text><Text>— {m.total} companies</Text></View>
        {m.outsideClient.length ? <View style={[s.tocRow, { marginTop: 8 }]}><Text style={{ flex: 1 }}>Client-list companies outside the criteria</Text><Text>— {m.outsideClient.length} (not counted above)</Text></View> : null}
        <Text style={{ marginTop: 6, fontSize: 10.5 }}>Appendix A — Contact directory{'\n'}Appendix B — Country context{'\n'}Appendix C — Excluded companies</Text>
        <Text style={[s.h2, { marginTop: 22, fontSize: 13 }]}>How to read each entry</Text>
        <Row label="Who to approach">The best first contact for requesting a CEO interview and discussing a company profile: the press spokesperson or communications head where one is published, otherwise the press office, management-board office or switchboard.</Row>
        <Row label="√ and ?">√ found on the company&apos;s own website or the cited page. ? from the search-based research but not confirmed automatically — check before calling.</Row>
        <Row label="Commercial qualification">{`Checked from the researched figures, not from a label. Qualified = revenue above ${minRev}. Likely qualified = revenue unconfirmed or unpublished, with strong scale evidence.`}</Row>
        <Row label="Contacts">{m.stats.withAny} of {m.total} companies have a phone or email; {m.stats.withPerson} have a named person; {m.stats.withMobile} have a business mobile ({m.stats.mobiles} mobiles, {m.stats.mobilesOk} confirmed).</Row>
        <Foot />
      </Page>

      {m.sections.map((sec) => (
        <Page key={sec.sector} size="A4" style={s.page} wrap>
          <Text style={s.h2}>{sec.sector}</Text>
          <Text style={s.count}>{sec.companies.length} companies identified in this sector · {m.total} in the whole report.</Text>
          {sec.companies.map((c, i) => <CompanyBlock key={c.id} c={c} no={i + 1} />)}
          <Foot />
        </Page>
      ))}

      {m.outsideClient.length ? (
        <Page size="A4" style={s.page} wrap>
          <Text style={s.h2}>Client-list companies outside the criteria</Text>
          <Text style={s.count}>{m.outsideClient.length} companies named in the client&apos;s brief that do not meet the criteria — kept here, fully researched; not counted in the {m.total}.</Text>
          {m.outsideClient.map((c, i) => <CompanyBlock key={c.id} c={c} no={i + 1} />)}
          <Foot />
        </Page>
      ) : null}

      <Page size="A4" style={s.page} wrap>
        <Text style={s.h2}>Appendix A — Contact directory</Text>
        <View style={s.tblHead} fixed><Text style={{ width: '22%' }}>Company</Text><Text style={{ width: '26%' }}>Contact</Text><Text style={{ width: '16%' }}>Direct line</Text><Text style={{ width: '14%' }}>Mobile</Text><Text style={{ width: '22%' }}>Email</Text></View>
        {dir.map(({ c, e }, i) => (
          <View key={i} style={s.tblRow} wrap={false}>
            <Text style={{ width: '22%' }}>{c.profile?.name || c.name}</Text>
            <Text style={{ width: '26%' }}>{e.name}{e.role ? `\n${e.role}` : ''}</Text>
            <Text style={{ width: '16%' }}>{e.phone}{e.phone ? <Mark v={e.checks.phone} /> : null}</Text>
            <Text style={{ width: '14%' }}>{e.mobile}{e.mobile ? <Mark v={e.checks.mobile} /> : null}</Text>
            <Text style={{ width: '22%' }}>{e.email}{e.email ? <Mark v={e.checks.email} /> : null}</Text>
          </View>
        ))}
        <Foot />
      </Page>

      <Page size="A4" style={s.page} wrap>
        <Text style={s.h2}>Appendix B — Country context</Text>
        {(ctx.narrative || []).map((r, i) => <View key={i} style={{ marginBottom: 6 }} wrap={false}><Text style={{ fontWeight: 'bold' }}>{r.theme}</Text><Text>{r.summary}</Text>{r.why_it_matters ? <Text style={{ fontStyle: 'italic' }}>Why it matters: {r.why_it_matters}</Text> : null}<Text style={s.small}>{r.source_url}</Text></View>)}
        {([['key_figures', 'Key figures', ['metric', 'value', 'as_of']], ['government', 'Key officials', ['name', 'role', 'in_office_since', 'relevance']], ['institutions', 'Institutions (access opportunities)', ['name', 'leader', 'why_access_matters', 'official_contact']], ['events', 'Events', ['name', 'date', 'location', 'relevance']], ['bilateral', 'Cross-border links', ['partner', 'summary', 'flagship_deals', 'companies_involved']]] as const).map(([key, title, cols]) => {
          const rows = (ctx[key] || []) as Record<string, string>[]
          if (!rows.length) return null
          return (
            <View key={key} style={{ marginTop: 10 }}>
              <Text style={{ fontWeight: 'bold', fontSize: 11, marginBottom: 3 }}>{title}</Text>
              {rows.map((r, i) => <View key={i} style={s.tblRow} wrap={false}>{cols.map((col) => <Text key={col} style={{ width: `${100 / cols.length}%`, paddingRight: 4 }}>{r[col]}</Text>)}</View>)}
            </View>
          )
        })}
        <Foot />
      </Page>

      <Page size="A4" style={s.page} wrap>
        <Text style={s.h2}>Appendix C — Excluded companies</Text>
        <Text style={{ marginBottom: 6, color: '#444' }}>Researched or considered, and left out under the criteria.</Text>
        {m.excluded.map((x, i) => <View key={i} style={s.tblRow} wrap={false}><Text style={{ width: '35%' }}>{x.name}</Text><Text style={{ width: '65%' }}>{x.reason}</Text></View>)}
        <Foot />
      </Page>
    </Document>
  )
}

export async function buildCiPdf(m: ReportModel): Promise<Buffer> {
  return renderToBuffer(<ReportDoc m={m} />)
}
