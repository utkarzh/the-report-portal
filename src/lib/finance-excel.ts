import ExcelJS from 'exceljs'
import { SUB_LINES_BY_CATEGORY, EXCEL_CATEGORY_HEADERS } from '@/lib/finance-categories'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpense, FinanceExpenseCategory, FinanceProject } from '@/types'

const CATEGORY_ORDER: FinanceExpenseCategory[] = [
  'transport', 'accommodation', 'communications', 'other_services', 'printing_office', 'bank_charges',
]

// Reproduces the client's real caja Excel template exactly, per her
// consultant guide: the same mandatory header fields, the same 6 categories
// with the same fixed sub-lines, real SUM formulas for category subtotals
// (never a hand-entered total), and a real formula linking local currency to
// the settlement currency via the header's exchange-rate cell — EXCEPT for a
// line where the receipt itself already showed both currencies, where her
// rule is to use the ticket's own numbers for both columns rather than the
// formula (detected here by the stored amount not matching rate-division,
// since that column isn't tracked as its own flag on the expense row).
export async function buildCajaWorkbook(params: {
  project: Pick<FinanceProject, 'name' | 'country' | 'media_publication' | 'local_currency' | 'settlement_currency' | 'exchange_rate'>
  weekLabel: string // "Week 3", or "Custom" when the range doesn't match a project week
  weekStart: string
  weekEnd: string
  expenses: FinanceExpense[] // already filtered to this week, rejected excluded
  carriedForward: number
  fundsReceivedThisWeek: number
}): Promise<ExcelJS.Buffer> {
  const { project, weekLabel, weekStart, weekEnd, expenses, carriedForward, fundsReceivedThisWeek } = params

  const wb = new ExcelJS.Workbook()
  // Excel sheet names: max 31 chars, no \ / * ? : [ ]
  const sheetName = weekLabel.replace(/[\\/*?:[\]]/g, '-').slice(0, 31)
  const sheet = wb.addWorksheet(sheetName)
  sheet.columns = [{ width: 34 }, { width: 20 }, { width: 16 }, { width: 16 }]

  const bold = { font: { bold: true } }
  const sectionFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
  const sectionFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } }

  sheet.getCell('A1').value = 'CAJA'
  sheet.getCell('A1').font = { bold: true, size: 16 }
  sheet.getCell('B1').value = project.name

  sheet.getCell('A3').value = 'Country'
  sheet.getCell('A3').font = bold.font
  sheet.getCell('B3').value = project.country
  sheet.getCell('A4').value = 'Media'
  sheet.getCell('A4').font = bold.font
  sheet.getCell('B4').value = project.media_publication
  sheet.getCell('A5').value = 'Currency'
  sheet.getCell('A5').font = bold.font
  sheet.getCell('B5').value = project.local_currency || project.settlement_currency
  sheet.getCell('A6').value = 'Exchange rate'
  sheet.getCell('A6').font = bold.font
  sheet.getCell('B6').value = Number(project.exchange_rate) // every conversion formula below references $B$6
  const RATE_CELL = '$B$6'
  sheet.getCell('A7').value = 'Week'
  sheet.getCell('A7').font = bold.font
  sheet.getCell('B7').value = `${weekLabel}: ${weekStart} – ${weekEnd}`

  let row = 9
  const categorySubtotalCells: string[] = []

  for (const category of CATEGORY_ORDER) {
    const headerRow = row
    sheet.getCell(`A${headerRow}`).value = EXCEL_CATEGORY_HEADERS[category]
    for (const col of ['A', 'B', 'C', 'D']) {
      sheet.getCell(`${col}${headerRow}`).fill = sectionFill
      sheet.getCell(`${col}${headerRow}`).font = sectionFont
    }
    row++

    sheet.getCell(`A${row}`).value = 'Concept'
    sheet.getCell(`B${row}`).value = 'Sub-line'
    sheet.getCell(`C${row}`).value = `Local (${project.local_currency || project.settlement_currency})`
    sheet.getCell(`D${row}`).value = project.settlement_currency
    ;['A', 'B', 'C', 'D'].forEach(col => { sheet.getCell(`${col}${row}`).font = bold.font })
    row++

    const firstDataRow = row
    const categoryExpenses = expenses.filter(e => e.category === category)

    if (categoryExpenses.length === 0) {
      // Her template tolerates sparse weeks — an empty category is a blank
      // row, not an omitted section (§8: "the automation must handle sparse
      // Excels gracefully").
      row++
    } else {
      for (const e of categoryExpenses) {
        sheet.getCell(`A${row}`).value = e.concept
        sheet.getCell(`B${row}`).value = e.sub_line || SUB_LINES_BY_CATEGORY[category][SUB_LINES_BY_CATEGORY[category].length - 1]
        sheet.getCell(`C${row}`).value = Number(e.local_amount)

        const computedFromRate = Number(e.local_amount) / Number(project.exchange_rate)
        const matchesRateFormula = Math.abs(computedFromRate - Number(e.settlement_amount)) < 0.01
        if (matchesRateFormula) {
          sheet.getCell(`D${row}`).value = { formula: `C${row}/${RATE_CELL}` } as ExcelJS.CellFormulaValue
        } else {
          // The receipt itself showed both currencies — her rule is to use
          // the ticket's own numbers for both columns, not the header rate.
          sheet.getCell(`D${row}`).value = Number(e.settlement_amount)
        }
        row++
      }
    }

    const lastDataRow = row - 1
    // Short label here on purpose — the section header two rows up already
    // carries the full "(NEED APPROVAL AND ARE EXCEPTIONAL)" qualifier for
    // other_services; repeating it on the totals row is just noise.
    sheet.getCell(`A${row}`).value = `TOTAL — ${FINANCE_EXPENSE_CATEGORY_LABELS[category]}`
    sheet.getCell(`A${row}`).font = bold.font
    const subtotalCell = `D${row}`
    sheet.getCell(subtotalCell).value = { formula: `SUM(D${firstDataRow}:D${lastDataRow})` } as ExcelJS.CellFormulaValue
    sheet.getCell(subtotalCell).font = bold.font
    categorySubtotalCells.push(subtotalCell)
    row += 2
  }

  // Balance section — carried forward + new funds − total expenses = final
  // balance, exactly the four lines her template tracks (§2.2), and
  // reconciled against cash on hand the same way (§6.6): Opening − Expenses
  // = Remaining.
  row++
  sheet.getCell(`A${row}`).value = 'BALANCE'
  sheet.getCell(`A${row}`).font = { bold: true, size: 13 }
  row++

  sheet.getCell(`A${row}`).value = 'Balance carried forward from previous week'
  sheet.getCell(`D${row}`).value = carriedForward
  const carriedForwardCell = `D${row}`
  row++

  sheet.getCell(`A${row}`).value = 'New funds received this week'
  sheet.getCell(`D${row}`).value = fundsReceivedThisWeek
  const fundsReceivedCell = `D${row}`
  row++

  sheet.getCell(`A${row}`).value = 'Total expenses this week'
  sheet.getCell(`D${row}`).value = { formula: `${categorySubtotalCells.join('+')}` } as ExcelJS.CellFormulaValue
  const totalExpensesCell = `D${row}`
  sheet.getCell(`A${row}`).font = bold.font
  sheet.getCell(`D${row}`).font = bold.font
  row++

  sheet.getCell(`A${row}`).value = 'Final remaining balance'
  sheet.getCell(`D${row}`).value = { formula: `${carriedForwardCell}+${fundsReceivedCell}-${totalExpensesCell}` } as ExcelJS.CellFormulaValue
  sheet.getCell(`A${row}`).font = { bold: true, size: 12 }
  sheet.getCell(`D${row}`).font = { bold: true, size: 12 }

  return wb.xlsx.writeBuffer()
}
