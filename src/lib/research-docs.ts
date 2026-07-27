import { SAMPLE_ACCEPT, SAMPLE_EXT_RE } from '@/lib/documents'

// Company documents attached to an interview (annual reports, sustainability
// reports, etc.). Same accepted formats + server-side extractor as the admin
// document-samples feature; different (private, per-user) bucket.
export const RESEARCH_DOCS_BUCKET = 'research-documents'
export const MAX_RESEARCH_DOCS = 5

export { SAMPLE_ACCEPT, SAMPLE_EXT_RE }
