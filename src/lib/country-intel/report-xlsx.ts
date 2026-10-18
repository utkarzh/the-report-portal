import ExcelJS from 'exceljs'
import { entriesOf, confirmed, othersOf, revenueText, type ReportModel } from './report-data'
import type { CiCompany, CiContactEntry } from './types'

const mark = (v?: string) => (confirmed(v) ? ' ✓' : v === 'unconfirmed' ? ' ⚠' : '')
const line = (e: CiContactEntry | null) => (e ? [e.name, e.role, e.phone && `tel ${e.phone}${mark(e.checks.phone)}`, e.mobile && `mob ${e.mobile}${mark(e.checks.mobile)}`, e.email && `${e.email}${mark(e.checks.email)}`].filter(Boolean).join(' · ') : '')

export async function buildCiWorkbook(m: ReportModel): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'TRC Editorial Tool — Country Intelligence'
  const head = (ws: ExcelJS.Worksheet) => {
    const r = ws.getRow(1)
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14419A' } }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }
  }

  const companyRow = (c: CiCompany, sector: string, no: number) => {
    const p = c.profile!
    const o = c.outreach
    return {
      no, sector, company: p.name || c.name, list: c.origin === 'client' ? 'Client list' : 'New find',
      qualification: c.verdict?.label || '', basis: c.verdict?.reason || '', website: p.website, hq: p.headquarters, ownership: p.ownership,
      ceo: p.leader.name, ceo_title: p.leader.title, revenue: revenueText(c),
      who: line(o?.primary || null), ask: o?.primary?.ask_for || '', approach: o?.approach || '',
      others: othersOf(c).map(line).join('\n'),
      switchboard: o?.switchboard ? [o.switchboard.phone, o.switchboard.email, o.switchboard.address].filter(Boolean).join(' · ') : '',
      relevance: p.theme_relevance, narrative: p.company_narrative,
      developments: p.recent_developments.map((d) => `${d.date ? d.date + ': ' : ''}${d.text}`).join('\n'),
      sources: [...p.sources.map((s) => s.url), ...(p.grounded_sources || []).map((s) => s.url)].slice(0, 6).join('\n'),
    }
  }
  const cols = [
    { header: '#', key: 'no', width: 5 }, { header: 'Sector', key: 'sector', width: 22 }, { header: 'Company', key: 'company', width: 30 },
    { header: 'List', key: 'list', width: 11 }, { header: 'Qualification', key: 'qualification', width: 15 }, { header: 'Basis', key: 'basis', width: 40 },
    { header: 'Website', key: 'website', width: 26 }, { header: 'Headquarters', key: 'hq', width: 16 }, { header: 'Ownership', key: 'ownership', width: 30 },
    { header: 'CEO / leader', key: 'ceo', width: 24 }, { header: 'Title', key: 'ceo_title', width: 28 }, { header: 'Revenue', key: 'revenue', width: 30 },
    { header: 'Who to approach', key: 'who', width: 50 }, { header: 'Ask for', key: 'ask', width: 28 }, { header: 'Suggested approach', key: 'approach', width: 50 },
    { header: 'Other contacts', key: 'others', width: 60 }, { header: 'Switchboard & address', key: 'switchboard', width: 40 },
    { header: 'Relevance to the report', key: 'relevance', width: 50 }, { header: 'Company narrative', key: 'narrative', width: 60 },
    { header: 'Recent developments', key: 'developments', width: 60 }, { header: 'Sources', key: 'sources', width: 50 },
  ]
  const ws = wb.addWorksheet('Companies')
  ws.columns = cols
  m.sections.forEach((s) => s.companies.forEach((c, i) => ws.addRow(companyRow(c, s.sector, i + 1))))
  ws.eachRow((r, n) => { if (n > 1) r.alignment = { vertical: 'top', wrapText: true } })
  head(ws)

  const wc = wb.addWorksheet('Contacts')
  wc.columns = [
    { header: 'Company', key: 'company', width: 30 }, { header: 'Sector', key: 'sector', width: 22 }, { header: 'Name', key: 'name', width: 26 },
    { header: 'Role', key: 'role', width: 34 }, { header: 'Direct line', key: 'phone', width: 18 }, { header: 'Line ✓', key: 'phoneOk', width: 8 },
    { header: 'Mobile', key: 'mobile', width: 18 }, { header: 'Mobile ✓', key: 'mobileOk', width: 9 }, { header: 'Email', key: 'email', width: 30 },
    { header: 'Email ✓', key: 'emailOk', width: 8 }, { header: 'Published at', key: 'url', width: 40 },
  ]
  const yes = (v?: string) => (confirmed(v) ? 'yes' : v === 'unconfirmed' ? 'check' : '')
  for (const s of m.sections) for (const c of s.companies) for (const e of entriesOf(c)) {
    if (!e.phone && !e.mobile && !e.email) continue
    wc.addRow({ company: c.profile?.name || c.name, sector: s.sector, name: e.name, role: e.role, phone: e.phone, phoneOk: yes(e.checks.phone), mobile: e.mobile, mobileOk: yes(e.checks.mobile), email: e.email, emailOk: yes(e.checks.email), url: e.source_url })
  }
  head(wc)

  if (m.outsideClient.length) {
    const wo = wb.addWorksheet('Client list — outside criteria')
    wo.columns = cols
    m.outsideClient.forEach((c, i) => wo.addRow(companyRow(c, c.sector || '', i + 1)))
    wo.eachRow((r, n) => { if (n > 1) r.alignment = { vertical: 'top', wrapText: true } })
    head(wo)
  }
  const wx = wb.addWorksheet('Excluded')
  wx.columns = [{ header: 'Company', key: 'name', width: 40 }, { header: 'Reason', key: 'reason', width: 80 }]
  m.excluded.forEach((x) => wx.addRow(x))
  head(wx)
  return wb.xlsx.writeBuffer()
}
