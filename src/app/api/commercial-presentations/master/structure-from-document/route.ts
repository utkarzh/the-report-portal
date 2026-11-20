import { NextRequest, NextResponse } from 'next/server'
import { getAnthropicClient, isClaudeKeyRejected, CLAUDE_KEY_REJECTED_MESSAGE } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { extractSampleText } from '@/lib/sample-extract'
import { CLAUDE_MODEL } from '@/lib/commercial-presentations'
import { loadMasterRow, requireAdminActor, requirePresentationActor } from '@/lib/commercial-presentations-server'
import {
  STRUCTURE_IMPORT_SCHEMA,
  structureFromImport,
  structureImportSystemPrompt,
  validateStructureImportPrompt,
} from '@/lib/commercial-presentations-structure-import'

export const maxDuration = 180

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

// POST (multipart: file) — read an uploaded presentation document and propose
// the structure (blocks of SAY / ACTION / NOTE + manual fields). Admin-only,
// one-shot, and NOTHING is saved here: the editor shows the result as an
// unsaved draft, and the normal Save (PUT /master) versions it. Same pattern
// as Interview Letters' template-from-document.
export async function POST(request: NextRequest) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const denied = requireAdminActor(actor)
  if (denied) return denied

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!file || !(file instanceof File)) return NextResponse.json({ error: 'Choose a document to upload.' }, { status: 400 })
  // Read fully into memory below, so cap it (platforms without a request-size
  // limit would otherwise accept anything).
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 15 MB. Upload just the presentation script.' }, { status: 413 })
  }

  let extracted
  try {
    extracted = await extractSampleText(file.name, Buffer.from(await file.arrayBuffer()))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read that document.' }, { status: 422 })
  }

  // The admin's saved instructions, else the built-in default (also before
  // migration 050, when the row can't exist yet).
  const promptRow = await loadMasterRow('structure_import_prompt', null).catch(() => null)
  const system = structureImportSystemPrompt(promptRow ? validateStructureImportPrompt(promptRow.content).prompt : null)

  const anthropic = getAnthropicClient()
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16_000,
      system,
      messages: [
        {
          role: 'user',
          content: `--- DOCUMENT (${file.name}) ---\n${extracted.text}\n\nTurn this into the presentation structure now.`,
        },
      ],
      output_config: { format: { type: 'json_schema', schema: STRUCTURE_IMPORT_SCHEMA } },
    }, { timeout: (maxDuration - 10) * 1000, maxRetries: 0 })

    const usage = parseUsage(message.usage as unknown, 0)
    const promptTokens = totalPromptTokens(usage)
    await logUsageEvent({
      userId: actor.id,
      workflow: 'commercial_presentation_structure_import',
      model: CLAUDE_MODEL,
      tokensInput: promptTokens,
      tokensOutput: usage.outputTokens,
      tokensTotal: promptTokens + usage.outputTokens,
      costUsd: calculateCost(usage),
      status: message.stop_reason === 'max_tokens' ? 'error' : 'success',
      error: message.stop_reason === 'max_tokens' ? 'Output cut off at max_tokens' : null,
    })
    if (message.stop_reason === 'max_tokens') {
      return NextResponse.json({ error: 'That document is too long to read in one go. Upload just the presentation script.' }, { status: 422 })
    }

    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const result = structureFromImport(JSON.parse(text))
    if (!result.ok) return NextResponse.json({ error: `No usable structure was found in that document (${result.error})` }, { status: 422 })
    return NextResponse.json({ structure: result.value, truncated: extracted.truncated, fileName: file.name })
  } catch (err) {
    console.error('Presentation structure import failed:', err)
    await logUsageEvent({
      userId: actor.id,
      workflow: 'commercial_presentation_structure_import',
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Structure import failed',
    })
    return NextResponse.json(
      { error: isClaudeKeyRejected(err) ? CLAUDE_KEY_REJECTED_MESSAGE : 'Could not build a structure from that document. Please try again.' },
      { status: 500 },
    )
  }
}
