// The only accounts that may use the Sales Coach admin tools (knowledge
// documents, the cross-team negotiations list) and download uploaded
// recordings. Deliberately an explicit email allowlist, independent of the
// platform `admin` role: other platform admins are excluded, and a listed
// account doesn't need to be an admin (client request, Oct 2026).
export const SALES_COACH_ADMIN_EMAILS = [
  'rafael@the-report.com',
  'elizabeth@the-report.com',
  'utkarsh.parihar.435+w@gmail.com',
  'utkarsh.parihar.435@gmail.com',
]

export function isSalesCoachAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return SALES_COACH_ADMIN_EMAILS.includes(email.trim().toLowerCase())
}

// The Pattern Analysis PDF report: only these two accounts may download it
// (17 Nov 2026, client request), a narrower list than the admins above, who
// can still run and read analyses on screen.
export const SALES_COACH_PATTERN_PDF_EMAILS = [
  'rafael@the-report.com',
  'utkarsh.parihar.435@gmail.com',
]

export function canDownloadPatternPdf(email: string | null | undefined): boolean {
  if (!email) return false
  return SALES_COACH_PATTERN_PDF_EMAILS.includes(email.trim().toLowerCase())
}
