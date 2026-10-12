// Accounts allowed to download a transcription's uploaded audio. Same three
// people as Sales Coach's admin allowlist (see sales-coach-admins.ts) — kept
// as a separate list on purpose, per this codebase's sibling-builder pattern:
// the two modules' admin concepts are otherwise unrelated (this one is just
// about audio download, not broader Transcription admin powers), even though
// today's membership is identical.
export const TRANSCRIPTION_AUDIO_ADMIN_EMAILS = [
  'rafael@the-report.com',
  'elizabeth@the-report.com',
  'utkarsh.parihar.435+w@gmail.com',
]

export function isTranscriptionAudioAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return TRANSCRIPTION_AUDIO_ADMIN_EMAILS.includes(email.trim().toLowerCase())
}
