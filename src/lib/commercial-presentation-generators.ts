import { postSse, readSseStream } from '@/lib/sse-client'
import { API_PATH } from '@/lib/commercial-presentations'
import type { InterviewLetterCompany, Project } from '@/types'

// The "generate" half of fetch-or-generate (brief §10). Reuses the EXISTING
// Editorial Brief and Interview Letter functionality by calling their own
// API routes exactly as their own pages do — nothing is copied or forked, so
// both modules keep their own prompts, validation, token gates, billing and
// usage logging. The user needs access to that module (admins have all).
//
// Each generated document is attached to the project as soon as it exists,
// so closing the tab mid-run never orphans it: reopening shows it as the
// project's brief/letter and the brief can be resumed.

const BRIEF_MAX_PASSES = 12 // same cap as the Editorial Briefs page

async function attach(presentationId: string, kind: 'brief' | 'letter', id: string) {
  const res = await fetch(`${API_PATH}/${presentationId}/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, id, source: 'generated' }),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error((d as { error?: string }).error || 'Could not attach the document to the project')
  }
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || fallback)
  return data
}

// Runs Editorial Brief passes until the document is complete. Each pass is
// the same request the Editorial Briefs page sends (continue: true after the
// first), and the server persists as it streams.
export async function runEditorialBriefToCompletion(
  briefId: string,
  onProgress: (message: string) => void,
  opts: { startWithContinue?: boolean } = {},
): Promise<void> {
  for (let pass = 1; pass <= BRIEF_MAX_PASSES; pass++) {
    onProgress(pass === 1 ? 'Writing the Editorial Brief…' : `Writing the Editorial Brief (part ${pass})…`)
    const res = await fetch(`/api/documents/${briefId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ continue: pass > 1 || opts.startWithContinue === true, additionalPrompt: '' }),
    })
    if (!res.ok) await jsonOrThrow(res, 'Editorial Brief generation failed')
    let done: boolean | undefined
    let error: string | undefined
    let chars = 0
    let lastReport = 0
    await readSseStream(res, (p) => {
      if (typeof p.error === 'string') error = p.error
      if (typeof p.text === 'string') {
        chars += p.text.length
        if (Date.now() - lastReport > 1000) {
          lastReport = Date.now()
          onProgress(`Writing the Editorial Brief (part ${pass}, ${Math.round(chars / 1000)}k characters)…`)
        }
      }
      if (typeof p.done === 'boolean') done = p.done
    })
    if (error) throw new Error(error)
    if (done === true) return
    // Stream ended without a verdict (dropped connection): ask the server.
    if (done === undefined) {
      const state = await jsonOrThrow<{ status?: string }>(await fetch(`/api/documents/${briefId}`), 'Could not check the brief')
      if (state.status === 'complete') return
    }
  }
  throw new Error('The Editorial Brief is still unfinished after the maximum number of passes. Open it in Editorial Briefs to continue.')
}

export async function generateEditorialBrief(input: {
  presentationId: string
  project: Pick<Project, 'name' | 'country' | 'media_name' | 'anchor_event' | 'anchor_date' | 'edition'>
  mediaCountry: string
  onProgress: (message: string) => void
}): Promise<string> {
  const { project } = input
  input.onProgress('Creating the Editorial Brief…')
  const context = [
    `Prepared for the ${project.name} project's commercial presentation.`,
    project.anchor_event ? `Anchor event / editorial momentum: ${project.anchor_event}${project.anchor_date ? ` (${project.anchor_date})` : ''}.` : '',
    project.edition ? `Edition: ${project.edition}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const created = await jsonOrThrow<{ id: string }>(
    await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        docType: 'editorial_brief',
        projectCountry: project.country,
        mediaPartner: project.media_name,
        mediaCountry: input.mediaCountry,
        additionalContext: context,
      }),
    }),
    'Could not create the Editorial Brief',
  )
  await attach(input.presentationId, 'brief', created.id)
  await runEditorialBriefToCompletion(created.id, input.onProgress)
  return created.id
}

export interface LetterSender {
  name: string
  title: string
  contact: string
}

// Create → research (the module's own streamed research, which also proposes
// the why-now hook) → draft letter using that AI hook. The result is a letter
// project at "letter review": usable as a source, labelled "not reviewed"
// until someone final-approves it in Interview Letters.
export async function generateInterviewLetter(input: {
  presentationId: string
  company: InterviewLetterCompany
  project: Pick<Project, 'country' | 'media_name' | 'anchor_event' | 'anchor_date' | 'editorial_brief_id'>
  mediaCountry: string
  sender: LetterSender
  onProgress: (message: string) => void
}): Promise<string> {
  const { project } = input
  input.onProgress('Creating the Interview Request Letter…')
  const created = await jsonOrThrow<{ id: string }>(
    await fetch('/api/interview-letters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: input.company,
        projectCountry: project.country,
        mediaPartner: project.media_name,
        mediaPartnerCountry: input.mediaCountry,
        hookInput: project.anchor_event,
        senderName: input.sender.name,
        senderTitle: input.sender.title,
        senderContact: input.sender.contact,
        letterVariant: project.anchor_event ? 'anchor' : 'no_anchor',
        anchor: project.anchor_event,
        publicationTiming: project.anchor_date,
        reportSector: '',
        editorialBriefId: project.editorial_brief_id ?? null,
      }),
    }),
    'Could not create the Interview Request Letter',
  )
  await attach(input.presentationId, 'letter', created.id)

  input.onProgress('Researching for the letter…')
  const research = await postSse<{ hookAiSuggestion?: string }>(`/api/interview-letters/${created.id}/research`, {}, (p) => {
    if (p.status === 'web_search_start') input.onProgress('Researching for the letter (searching the web)…')
    if (p.status === 'synthesising' || p.status === 'refining') input.onProgress('Researching for the letter (summarising)…')
  })
  const hook = (research.hookAiSuggestion || '').trim()
  if (!hook) throw new Error('The letter research did not propose a hook. Open the letter in Interview Letters to finish it.')

  input.onProgress('Drafting the letter…')
  await jsonOrThrow(
    await fetch(`/api/interview-letters/${created.id}/letter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook, hookSource: 'ai' }),
    }),
    'Could not draft the letter',
  )
  return created.id
}
