// Build the presentation structure from an uploaded document (Admin →
// Structure & locked methodology → "Build from a document"). Same pattern as
// Interview Letters' template-from-document: the document is read, Claude
// splits it into blocks of SAY / ACTION / NOTE lines plus the manual fields,
// and the result is only a DRAFT in the editor — nothing is saved until the
// admin reviews it and presses Save. Pure (no I/O) so it can be tested.

import { BUILT_IN_VARIABLES, normalizeVarKey, validateStructure } from './commercial-presentations'
import type { PresentationStructure } from '@/types'

export const STRUCTURE_IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      description: 'The presentation’s blocks, top to bottom, in the document’s own order.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The block’s title as the document gives it, e.g. "Chit Chat and Seating". Keep [VARIABLE] tokens such as [COUNTRY].' },
          type: {
            type: 'string',
            enum: ['template', 'agency', 'media', 'why_now'],
            description:
              '"template": fixed methodology / master wording, the same for every project. "agency": the block where the agency presents itself (e.g. "Presenting Ourselves"). "media": the block presenting the media partner and its product/distribution (replaced by each publication’s own script). "why_now": the AI-written "Why [Country] Now" block.',
          },
          badge: { type: 'string', description: 'Short content-type label from the document if it gives one (e.g. "Locked methodology", "Master content + manual variables"), else empty.' },
          segments: {
            type: 'array',
            description: 'The block’s lines in order. Empty for a "media" block. For "why_now": one SAY line "[WHY NOW]", plus any fixed wording the document puts around it.',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['say', 'action', 'note'], description: '"say": words the salesperson speaks. "action": what they physically do / instructions to them. "note": internal guidance not spoken (objectives, tips).' },
                text: { type: 'string', description: 'The wording VERBATIM from the document (without surrounding quotation marks). Keep [VARIABLE] tokens exactly; write known values as tokens.' },
                heading: { type: 'string', description: 'A sub-heading the document puts over this line (e.g. "Seating", "Say if required", "Commercial transition"), else empty.' },
                condition: { type: 'string', enum: ['always', 'show_if', 'hide_if'], description: 'show_if: only when a variable has a value (e.g. the "IF THERE IS AN ANCHOR EVENT" wording). hide_if: only when it is empty (the "IF THERE IS NO ANCHOR EVENT" wording). Else always.' },
                conditionVariable: { type: 'string', description: 'For show_if / hide_if: the variable key, e.g. "ANCHOR EVENT". Else empty.' },
              },
              required: ['kind', 'text', 'heading', 'condition', 'conditionVariable'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'type', 'badge', 'segments'],
        additionalProperties: false,
      },
    },
    manualFields: {
      type: 'array',
      description: 'Inputs the commercial team fills in per project (e.g. people to mention, mockup main interview). One per [VARIABLE] the document uses that is NOT a built-in variable.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The variable key in capitals, exactly as used in the lines, e.g. "MAIN SECTORS" for [MAIN SECTORS].' },
          label: { type: 'string', description: 'Short label for the input form, e.g. "Mockup – main sectors".' },
          placeholder: { type: 'string', description: 'An example value starting "e.g.", if the document suggests one, else empty.' },
          required: { type: 'boolean', description: 'True unless the document marks it optional.' },
          multiline: { type: 'boolean', description: 'True for lists or longer free text (e.g. people to mention).' },
        },
        required: ['key', 'label', 'placeholder', 'required', 'multiline'],
        additionalProperties: false,
      },
    },
  },
  required: ['blocks', 'manualFields'],
  additionalProperties: false,
} as const

function builtInStructureImportPrompt(): string {
  const builtIns = BUILT_IN_VARIABLES.map((v) => `[${v.key}]`).join(', ')
  return `You configure the standard commercial presentation used by The Report Company / Global FDI Reports at the start of meetings with CEOs and ministers. You are given a document describing that presentation (a script, a methodology document or a template) and must turn it into the platform's structure: an ordered list of blocks, each made of SAY / ACTION / NOTE lines, plus the manual input fields.

RULES
- Keep the document's wording VERBATIM. Never summarise, improve or invent lines. Drop only surrounding quotation marks. The only changes allowed are the three below (variables, direct speech, the missing no-anchor line).
- Keep the document's own block order and block titles.
- SAY = words spoken to the interviewee. ACTION = what the salesperson does / instructions to them. NOTE = internal guidance that is neither (objectives, tips).
- Variables are written in square brackets in capitals, e.g. [COUNTRY]. Built-in variables the platform fills automatically: ${builtIns}. Use them where the document refers to those values (agency, media, country, media market, anchor event, relevant date). A placeholder the salesperson fills in live during the meeting (e.g. [NAME] for the interviewee) stays exactly as written and is NOT a manual field.
- Alternative wordings "with / without an anchor event" (or any "if there is … / if there is no …") become two lines: the first with condition show_if and the second with hide_if, both on the same variable (e.g. ANCHOR EVENT). The condition replaces the document's "IF THERE IS …" label, so don't also use that label as the line's heading.
- Manual fields: one for every other bracketed variable that appears in your lines and that the team fills in per project (people to mention, mockup main interview, investment angle, main sectors, …). Use the exact key that appears in the lines. Never create a manual field for a built-in variable, for a live placeholder like [NAME], or for a variable no line uses.
- A field's placeholder is "e.g. " plus a value the document itself gives for it (an example name, list or wording). If the document gives none, leave the placeholder empty. Never make up example values.
- Never add a line the document doesn't contain. The only exception is the missing no-anchor line described below.
- Block types: the agency presenting itself → "agency" (keep its lines; they are the fallback wording); the media partner and its product / distribution → "media" with NO lines (each publication has its own approved script); the AI-written Why [Country] Now → "why_now" with a single SAY line "[WHY NOW]" plus any fixed wording the document wraps around it; everything else → "template".
- At most one "media" block and one "why_now" block.
- Ignore developer notes, explanations of the system, and example disclaimers (e.g. "this USA Today copy is only an example").
- Never write the same point twice (e.g. once as ACTION and again as SAY): an instruction with words to say becomes an ACTION for what to do plus a SAY for the words.

THIS IS A TEMPLATE FOR EVERY PROJECT — REPLACE PROJECT-SPECIFIC VALUES WITH VARIABLES
The document may be written for one example project (real names instead of brackets). The structure must work for every project, so:
- the country / the report's country → [COUNTRY]; the publication / media partner (e.g. USA Today) → [MEDIA]; the agency (e.g. The Report Company, Global FDI Reports) → [AGENCY]; the media's home market (e.g. "the US", "Germany") → [MEDIA MARKET]; an event the publication is timed around (e.g. "the G20 Summit in Miami") → [ANCHOR EVENT]; a planned date → [RELEVANT DATE]. Also in block titles ("Why Kazakhstan Now" → "Why [COUNTRY] Now").
- Project details the team supplies become manual-field variables, e.g. the mockup's main interview (e.g. "the President") → [MAIN INTERVIEW], its investment section → [INVESTMENT ANGLE], the listed sectors → [MAIN SECTORS], named people already interviewed → [PEOPLE TO MENTION]. Create the matching manual field for each, with the document's original value as its "e.g." placeholder.
- When a line mentions an anchor event but there is no version without it, add the no-anchor twin yourself: the same line with only the anchor clause removed (e.g. "… that we aim to publish in [MEDIA] around [ANCHOR EVENT]." with show_if ANCHOR EVENT, and "… that we aim to publish in [MEDIA]." with hide_if ANCHOR EVENT).
- Media-specific facts (audience, reach, distribution of one publication) belong to that publication's own script, not the structure: they go nowhere here, because the media block has no lines.

PLAIN-PROSE DOCUMENTS
The document may be ordinary paragraphs with no BLOCK / SAY / ACTION labels. Then:
- Split it into blocks by what each part of the meeting does (rapport and seating, presenting ourselves, the media, why now, the mockup, the close), keeping its order, and give each block a short clear title.
- Words to be spoken, even when written indirectly ("explain that we are working on…", "say that there is…", "mention that we partner with…"), become SAY lines in direct speech: the words themselves, changing only what direct speech needs (drop "explain that", adjust pronouns). Keep the document's phrasing otherwise.
- Instructions about what to do or how to behave ("start by thanking him", "show photographs…", "open the mockup", "try to sit next to the CEO") become ACTION lines.`
}

// The built-in instructions. Admins can replace them (Admin → Structure &
// locked methodology → reading instructions; master content kind
// 'structure_import_prompt', migration 050); this stays the default and is
// what "Reset to default" puts back. Only the instructions are editable — the
// output schema above is fixed in code, so an edit can't break the import.
export const DEFAULT_STRUCTURE_IMPORT_PROMPT = builtInStructureImportPrompt()

/** The admin's saved instructions, or the built-in default when there are none. */
export function structureImportSystemPrompt(custom?: string | null): string {
  return custom && custom.trim() ? custom.trim() : DEFAULT_STRUCTURE_IMPORT_PROMPT
}

export function validateStructureImportPrompt(raw: unknown): { prompt: string } {
  const o = (raw ?? {}) as Record<string, unknown>
  return { prompt: typeof o.prompt === 'string' ? o.prompt.slice(0, 40_000) : '' }
}

interface RawSegment {
  kind?: string
  text?: string
  heading?: string
  condition?: string
  conditionVariable?: string
}
interface RawBlock {
  title?: string
  type?: string
  badge?: string
  segments?: RawSegment[]
}
interface RawImport {
  blocks?: RawBlock[]
  manualFields?: { key?: string; label?: string; placeholder?: string; required?: boolean; multiline?: boolean }[]
}

const BUILT_IN_KEYS = new Set<string>(BUILT_IN_VARIABLES.map((v) => v.key))

// Turns Claude's answer into a valid structure. Repairs what the editor would
// otherwise refuse to save: extra media / Why Now blocks become templates, a
// Why Now block without [WHY NOW] gets one, a media block's lines are dropped,
// and manual fields for built-in variables are removed.
export function structureFromImport(raw: unknown): { ok: true; value: PresentationStructure } | { ok: false; error: string } {
  const r = (raw ?? {}) as RawImport
  let seenMedia = false
  let seenWhyNow = false
  const blocks = (r.blocks ?? []).map((b, i) => {
    let type = b.type === 'agency' || b.type === 'media' || b.type === 'why_now' ? b.type : 'template'
    // Only the first media / Why Now block keeps its type.
    if (type === 'media') {
      if (seenMedia) type = 'template'
      seenMedia = true
    } else if (type === 'why_now') {
      if (seenWhyNow) type = 'template'
      seenWhyNow = true
    }
    const segments =
      type === 'media'
        ? []
        : (b.segments ?? []).map((s) => {
            const variable = normalizeVarKey(s.conditionVariable ?? '')
            return {
              id: '',
              kind: s.kind,
              text: (s.text ?? '').trim(),
              heading: (s.heading ?? '').trim() || undefined,
              showIf: s.condition === 'show_if' && variable ? variable : undefined,
              hideIf: s.condition === 'hide_if' && variable ? variable : undefined,
            }
          })
    if (type === 'why_now' && !segments.some((s) => /\[\s*WHY\s+NOW\s*\]/i.test(s.text))) {
      segments.unshift({ id: '', kind: 'say', text: '[WHY NOW]', heading: undefined, showIf: undefined, hideIf: undefined })
    }
    return { key: `block_${i + 1}`, title: (b.title ?? '').trim() || `Block ${i + 1}`, type, typeLabel: (b.badge ?? '').trim(), segments }
  })
  const manualFields = (r.manualFields ?? []).filter((f) => !BUILT_IN_KEYS.has(normalizeVarKey(f.key ?? '')))
  // The shared validator does the rest (ids, key slugs, lengths, duplicates).
  return validateStructure({ blocks, manualFields })
}
