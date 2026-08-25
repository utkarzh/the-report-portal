import type { FinanceExpenseCategory } from '@/types'

// The 6 categories and their fixed sub-lines come from the client's real
// caja Excel (see docs/mockups/Armenia Caja Week 1 — an actual filled-in
// example she sent). The category set and the per-category grouping are
// non-negotiable (brief requirement #3); the exact on-screen wording is not
// — she's open to us doing better here as long as it stays easy for both
// field workers and Finance. So: these strings are OUR clean rendering, not
// a byte-for-byte copy of her spreadsheet's cell text (which has its own
// punctuation quirks — colons, periods, "ROOM FROM - TO:" — that only made
// sense as labels for fixed, empty rows waiting to be hand-filled).
export const SUB_LINES_BY_CATEGORY: Record<FinanceExpenseCategory, string[]> = {
  transport: ['Flights', 'Car Rental', 'Petrol/Parking/Tolls', 'Taxis', 'Other Trip Expenses'],
  accommodation: ['Room', 'Other Accommodation Expenses'],
  communications: ['Tel. period', 'Internet period', 'Other Expenses'],
  other_services: ['Office space', 'Courier', 'PR', 'Secretarial', 'Interpreters', 'Other'],
  printing_office: ['Newspapers/Magazines', 'Office Material', 'Photocopies'],
  bank_charges: ['Currency Exchange', 'Other Banking Expenses'],
}

export function defaultSubLine(category: FinanceExpenseCategory): string {
  const lines = SUB_LINES_BY_CATEGORY[category]
  return lines[lines.length - 1] // the catch-all "Other …" line for each category
}

// Excel-export-only headers (ALL-CAPS, matching the register of a printed
// form) — deliberately a SEPARATE constant from FINANCE_EXPENSE_CATEGORY_LABELS
// (types/index.ts), which stays plain Title Case for on-screen dropdowns/
// filters/badges. Only other_services carries a real-file-verbatim qualifier:
// her template appends "(NEED APPROVAL AND ARE EXCEPTIONAL)" to that header,
// and that's compliance-relevant information (this category needs prior
// sign-off, see finance-flags.ts), not just formatting — worth keeping in the
// exported artifact even though it'd be clutter in a UI dropdown.
export const EXCEL_CATEGORY_HEADERS: Record<FinanceExpenseCategory, string> = {
  transport: 'TRANSPORT / TRIPS',
  accommodation: 'ACCOMMODATION',
  communications: 'COMMUNICATION',
  other_services: 'OTHER PROFESSIONAL SERVICES (NEED APPROVAL AND ARE EXCEPTIONAL)',
  printing_office: 'INFORMATION / MATERIALS',
  bank_charges: 'BANK EXPENSES',
}
