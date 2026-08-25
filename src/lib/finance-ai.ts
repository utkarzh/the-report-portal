import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, OPUS_PRICING, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { SUB_LINES_BY_CATEGORY } from '@/lib/finance-categories'
import type { FinanceExpenseCategory, FinanceProject } from '@/types'

// Opus, not Sonnet: this reads handwritten annotations and low-quality field
// photos where accuracy directly affects money reconciliation — worth the
// added cost over the model used for text-only workflows elsewhere.
const EXTRACTION_MODEL = 'claude-opus-5'

export interface ExtractedEntry {
  concept: string
  category: FinanceExpenseCategory
  subLine: string
  date: string | null // ISO yyyy-mm-dd, null if genuinely unreadable
  reference: string | null
  vendor: string | null
  localAmount: number | null
  localCurrency: string | null
  // Present only when the receipt itself shows a settlement-currency amount
  // (brief §2: "when a receipt already shows both local and settlement
  // amounts, we use the receipt's numbers directly").
  settlementAmountFromReceipt: number | null
  // Nights stayed — only meaningful for accommodation, used by the
  // per-night budget flag. Null when not detectable; we never guess it.
  nights: number | null
  lowConfidenceFields: string[]
  suspiciousPersonal: boolean
  // Always populated (not just when suspicious) — Finance reads this
  // directly in the transaction list, e.g. "Handwritten taxi receipt for
  // ₹830 — looks genuine" or "Grocery-store receipt, likely personal."
  aiComment: string
  // Set only when this entry breaks one of the project's own admin-authored
  // rules (project.ai_rules) — null when no rules were given or none apply.
  ruleViolation: string | null
}

export interface ExtractionResult {
  entries: ExtractedEntry[]
  couldNotRead: boolean
  note: string
}

const CATEGORIES: FinanceExpenseCategory[] = [
  'transport', 'accommodation', 'communications', 'other_services', 'printing_office', 'bank_charges',
]
const ALL_SUB_LINES = Array.from(new Set(Object.values(SUB_LINES_BY_CATEGORY).flat()))

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      description: 'One entry per genuinely separate transaction. A ride-app screenshot showing several trips must produce one entry per trip (brief D-05) — never merge them into one total. But a SINGLE invoice/folio from one vendor (e.g. a hotel bill itemising room, breakfast, laundry) is one transaction and must produce exactly ONE entry at its grand total, tax included — never split a single invoice\'s line items into separate entries.',
      items: {
        type: 'object',
        properties: {
          concept: { type: 'string', description: 'What was purchased or the service received.' },
          category: { type: 'string', enum: CATEGORIES },
          subLine: { type: 'string', enum: ALL_SUB_LINES, description: 'The specific sub-line within the category that best matches (e.g. "Taxis" under transport). Pick the closest one; use the category\'s "Other …" line if nothing else fits.' },
          date: { type: ['string', 'null'], description: 'ISO yyyy-mm-dd. Null only if genuinely illegible — never invent a date.' },
          reference: { type: ['string', 'null'], description: 'Receipt/transaction number or vendor signature, used to catch duplicates. Null if none is visible.' },
          vendor: { type: ['string', 'null'], description: 'Vendor or location, where legible.' },
          localAmount: { type: ['number', 'null'], description: 'The amount as shown on the receipt, in its own local currency. Null only if genuinely illegible.' },
          localCurrency: { type: ['string', 'null'], description: 'ISO currency code of localAmount, e.g. INR, USD, EUR. Null only if genuinely illegible.' },
          settlementAmountFromReceipt: { type: ['number', 'null'], description: 'ONLY set this if the receipt itself explicitly also shows an amount in the settlement currency provided in context — otherwise null (conversion is computed separately from the project exchange rate).' },
          nights: { type: ['number', 'null'], description: 'Number of nights, ONLY for accommodation and ONLY if explicitly shown (e.g. "3 nights"). Null otherwise — never estimate.' },
          lowConfidenceFields: { type: 'array', items: { type: 'string' }, description: 'Names of fields above you are not confident about (e.g. "date", "reference"). Empty array if all fields are clear.' },
          suspiciousPersonal: { type: 'boolean', description: 'True only if the concept/vendor looks like a personal, non-business purchase unrelated to field work (e.g. groceries, clothing, entertainment) rather than a genuine field expense.' },
          aiComment: { type: 'string', description: 'One short, plain sentence for a human reviewer, ALWAYS present (not only when something is wrong) — e.g. "Handwritten taxi receipt for ₹830, looks genuine despite the amount being written by hand" or "Grocery-store receipt — likely a personal purchase, not project-related." This is what Finance reads instead of opening the image every time.' },
          ruleViolation: { type: ['string', 'null'], description: "If this project has its own specific rules (given in your instructions) and this entry breaks one of them, state which rule and why in one sentence. Null if no rules were given, or this entry doesn't break any of them." },
        },
        required: ['concept', 'category', 'subLine', 'date', 'reference', 'vendor', 'localAmount', 'localCurrency', 'settlementAmountFromReceipt', 'nights', 'lowConfidenceFields', 'suspiciousPersonal', 'aiComment', 'ruleViolation'],
        additionalProperties: false,
      },
    },
    couldNotRead: { type: 'boolean', description: 'True only if the image is not a legible receipt/screenshot/invoice at all (e.g. blank, unrelated photo, totally corrupted).' },
    note: { type: 'string', description: 'One short sentence of context for the field user, e.g. what was hard to read. Empty string if nothing to flag.' },
  },
  required: ['entries', 'couldNotRead', 'note'],
  additionalProperties: false,
} as const

// Vision extraction + AI judgement flags in a single call (brief E-02: only
// judgement calls use AI, deterministic checks run in code — suspiciousPersonal
// and aiComment here are the judgement call; everything else in the flag
// engine, see finance-flags.ts, is plain code).
export async function extractReceiptData(
  imageBase64: string,
  mediaType: string,
  project: Pick<FinanceProject, 'country' | 'settlement_currency' | 'exchange_rate' | 'ai_rules'>,
  userId: string,
): Promise<ExtractionResult> {
  const system = `You read field-expense receipts for TRC (The Report Company) sales/editorial staff working in ${project.country}. The settlement currency for this project is ${project.settlement_currency} at a rate of ${project.exchange_rate} local units per 1 ${project.settlement_currency}.

Extract every genuinely separate transaction shown. Handle photos (including low-quality or handwritten annotations), payment-app screenshots, and PDF invoices, in any language. A ride-app screenshot showing multiple trips must become multiple entries — one per trip. But a single vendor invoice or hotel folio that itemises several line items (e.g. room + breakfast + laundry on one hotel bill) is still just ONE transaction — extract it as ONE entry using the invoice's grand total, including any tax/service charge shown, not one entry per line item.

Never invent a value for a field you cannot actually read. If a field is unreadable, set it to null and list its name in lowConfidenceFields rather than guessing. This is a hard rule: a wrong invented amount or date is worse than an honest null.

Categorise each entry into exactly one of these six fixed categories — never invent a new one: transport (Transport/Trips), accommodation, communications (Communication), other_services (Other Professional Services — includes PR, interpreters, couriers), printing_office (Information/Materials), bank_charges (Bank Expenses). Also pick the closest specific sub-line within that category.

Every entry needs aiComment: one short, genuinely useful sentence a busy finance reviewer can read instead of opening the image — note anything relevant (handwritten, low quality but legible, unusually high/low for the concept, looks like a personal purchase, receipt shows two currencies, etc.), or simply confirm it looks like a normal, legible field expense.${
    project.ai_rules?.trim()
      ? `\n\nThis project also has its own specific rules from the admin. Treat them as strict, non-negotiable requirements — check every entry against them and set ruleViolation (naming the rule and why) on any entry that breaks one:\n"""\n${project.ai_rules.trim()}\n"""`
      : ''
  }`

  const anthropic = getAnthropicClient()
  const message = await anthropic.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 4000,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: 'Extract this receipt per your instructions.' },
        ],
      },
    ],
    output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
  })

  const usage = parseUsage(message.usage as unknown, 0)
  const promptTokens = totalPromptTokens(usage)
  await logUsageEvent({
    userId,
    workflow: 'finance_receipt_extraction',
    model: EXTRACTION_MODEL,
    tokensInput: promptTokens,
    tokensOutput: usage.outputTokens,
    tokensTotal: promptTokens + usage.outputTokens,
    costUsd: calculateCost(usage, OPUS_PRICING),
  })

  const text = message.content.map(b => (b.type === 'text' ? b.text : '')).join('')
  const parsed = JSON.parse(text) as ExtractionResult
  return parsed
}

export interface VerificationMismatch {
  field: string
  submittedValue: string
  visibleValue: string
  note: string
}

export interface EntryVerification {
  matches: boolean
  mismatches: VerificationMismatch[]
  ruleViolation: string | null
}

const VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      description: 'One verdict per submitted entry, in the exact same order they were given.',
      items: {
        type: 'object',
        properties: {
          matches: { type: 'boolean', description: 'True if every submitted field is consistent with what is actually visible on the receipt.' },
          mismatches: {
            type: 'array',
            description: 'Only REAL, meaningful disagreements — a different date, amount, vendor, or reference than what the receipt actually shows. Never flag trivial formatting differences (date format, rounding to the cent, minor wording in the concept). Empty array if nothing genuinely disagrees.',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string', description: 'Which field disagrees, e.g. "date", "localAmount", "vendor", "reference".' },
                submittedValue: { type: 'string', description: 'The value that was submitted.' },
                visibleValue: { type: 'string', description: 'What you can actually see on the receipt for this field.' },
                note: { type: 'string', description: 'One short sentence explaining the discrepancy for a human reviewer.' },
              },
              required: ['field', 'submittedValue', 'visibleValue', 'note'],
              additionalProperties: false,
            },
          },
          ruleViolation: { type: ['string', 'null'], description: "If this project has its own rules and this entry breaks one, name the rule and why. Null if no rules were given or none apply." },
        },
        required: ['matches', 'mismatches', 'ruleViolation'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries'],
  additionalProperties: false,
} as const

export interface SubmittedEntryForVerification {
  concept: string
  date: string
  localAmount: number
  localCurrency: string
  vendor: string | null
  reference: string | null
}

// The second look, per the client's own real-world complaint: a field
// worker can accept the AI's first read and then hand-edit a field before
// confirming (e.g. change the date), and nothing previously checked that
// edit against the receipt again. This re-examines the SAME image,
// independently, against whatever was FINALLY submitted — catching both
// honest mistakes and deliberate tampering — and separately checks the
// project's own admin-authored rules (project.ai_rules) one more time
// against the final data, not just the AI's first draft.
export async function verifyEntriesAgainstReceipt(
  imageBase64: string,
  mediaType: string,
  project: Pick<FinanceProject, 'country' | 'settlement_currency' | 'ai_rules'>,
  entries: SubmittedEntryForVerification[],
  userId: string,
): Promise<EntryVerification[]> {
  const system = `You are double-checking field-expense data before it is logged as real money for TRC (The Report Company), working in ${project.country}. A field worker uploaded this receipt image; it was read once already, and the field worker then confirmed or edited the resulting values. You are now looking at the SAME image again, independently, to check whether what was FINALLY submitted actually matches what you can see.

For each submitted entry (given in order below), compare it against the receipt. Only flag a mismatch when it's real and meaningful — a different date, a different amount, a different vendor or reference than what's actually printed or shown. Do not flag trivial formatting differences, rounding, or paraphrased wording.${
    project.ai_rules?.trim()
      ? `\n\nThis project also has its own specific rules from the admin, which you must treat as strict requirements — check each entry against them again using the final submitted values:\n"""\n${project.ai_rules.trim()}\n"""`
      : ''
  }`

  const anthropic = getAnthropicClient()
  const message = await anthropic.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 4000,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data: imageBase64 } },
          {
            type: 'text',
            text: `Here is what was finally submitted, as a JSON array in order:\n${JSON.stringify(
              entries.map((e, i) => ({ index: i, ...e })),
            )}\n\nCheck each one against the receipt per your instructions.`,
          },
        ],
      },
    ],
    output_config: { format: { type: 'json_schema', schema: VERIFICATION_SCHEMA } },
  })

  const usage = parseUsage(message.usage as unknown, 0)
  const promptTokens = totalPromptTokens(usage)
  await logUsageEvent({
    userId,
    workflow: 'finance_receipt_verification',
    model: EXTRACTION_MODEL,
    tokensInput: promptTokens,
    tokensOutput: usage.outputTokens,
    tokensTotal: promptTokens + usage.outputTokens,
    costUsd: calculateCost(usage, OPUS_PRICING),
  })

  const text = message.content.map(b => (b.type === 'text' ? b.text : '')).join('')
  const parsed = JSON.parse(text) as { entries: EntryVerification[] }
  return parsed.entries
}

// settlementAmount = localAmount / exchangeRate (exchangeRate is "local units
// per 1 settlement unit", matching how the project form captures it — see
// brief §2 and the mockup's "rate 83.20 INR/USD" convention). The receipt's
// own settlement-currency figure wins when present (brief §2: "we use the
// receipt's numbers directly").
export function computeSettlementAmount(entry: ExtractedEntry, exchangeRate: number): number | null {
  if (entry.settlementAmountFromReceipt != null) return entry.settlementAmountFromReceipt
  if (entry.localAmount == null || !exchangeRate) return null
  return Math.round((entry.localAmount / exchangeRate) * 100) / 100
}
