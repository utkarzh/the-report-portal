import type { CiDepth } from './types'

// Research depth presets. Everything that drives cost lives here, and the
// estimator below uses the same numbers, so the estimate shown before a run
// and the work the engine schedules can't drift apart.
//
// Per-unit costs are what the manual Poland run (13 Oct 2026, Gemini 3.8
// Flash with Google Search) actually measured, including the replies that
// skipped searching and had to be repeated:
//   discovery question ≈ $0.010 · selection ≈ $0.06 · profile batch of 4 ≈ $0.030
//   contact batch of 3 ≈ $0.010 · context question ≈ $0.008 · verification = free
export interface DepthPreset {
  label: string
  description: string
  questionsPerSector: number      // discovery questions per sector in round 1
  profileBatch: number            // companies per profile call
  profileDetail: 'lean' | 'standard' | 'full'
  contacts: boolean               // dedicated outreach-contact research pass
  contextQuestions: number        // country-context questions (0 = none)
  maxRounds: number               // discovery rounds allowed to reach the target count
  overgenerate: number            // candidates profiled per company wanted (some fail the criteria)
  selectModel: string
  costPerProfile: number          // USD per company profiled
  costPerContacts: number         // USD per company contact-researched
  costPerQuestion: number         // USD per discovery / context question
  costPerSelect: number           // USD per selection call
}

export const RESEARCH_MODEL = process.env.CI_RESEARCH_MODEL || 'gemini-3.8-flash'
export const DEEP_MODEL = process.env.CI_DEEP_MODEL || 'gemini-3.1-pro-preview'

export const DEPTHS: Record<CiDepth, DepthPreset> = {
  quick: {
    label: 'Quick',
    description: 'Company, leader, revenue and the contacts found while profiling. No separate contact search, no country context.',
    questionsPerSector: 1,
    profileBatch: 5,
    profileDetail: 'lean',
    contacts: false,
    contextQuestions: 0,
    maxRounds: 2,
    overgenerate: 1.35,
    selectModel: RESEARCH_MODEL,
    costPerProfile: 0.007,
    costPerContacts: 0,
    costPerQuestion: 0.011,
    costPerSelect: 0.06,
  },
  standard: {
    label: 'Standard',
    description: 'Full profile of every company and leader, a dedicated search for who to approach (spokespeople, mobiles, emails), and the country context.',
    questionsPerSector: 2,
    profileBatch: 4,
    profileDetail: 'standard',
    contacts: true,
    contextQuestions: 4,
    maxRounds: 3,
    overgenerate: 1.35,
    selectModel: RESEARCH_MODEL,
    costPerProfile: 0.009,
    costPerContacts: 0.0045,
    costPerQuestion: 0.011,
    costPerSelect: 0.06,
  },
  deep: {
    label: 'Deep',
    description: 'Everything in Standard, with longer profiles (more developments, statements and sources), wider discovery, the full country context and a stronger model for selection.',
    questionsPerSector: 3,
    profileBatch: 3,
    profileDetail: 'full',
    contacts: true,
    contextQuestions: 6,
    maxRounds: 3,
    overgenerate: 1.4,
    selectModel: DEEP_MODEL,
    costPerProfile: 0.016,
    costPerContacts: 0.0055,
    costPerQuestion: 0.012,
    costPerSelect: 0.2,
  },
}

export interface CostEstimate {
  expectedUsd: number
  budgetUsd: number      // hard stop: the run pauses before any call that would cross it
  minutes: number
  breakdown: { label: string; usd: number }[]
}

export function estimateRun(opts: {
  depth: CiDepth
  targetCount: number
  sectorCount: number
  clientCount: number
  includeContacts: boolean
  includeContext: boolean
}): CostEstimate {
  const d = DEPTHS[opts.depth]
  const sectors = Math.max(1, opts.sectorCount)
  const profiled = Math.ceil(Math.max(opts.targetCount, opts.clientCount) * d.overgenerate)
  // Later rounds ask a couple of extra discovery questions per sector.
  const questions = sectors * d.questionsPerSector + Math.ceil(sectors * 0.6) * (d.maxRounds - 1) * 0.5
  const discovery = questions * d.costPerQuestion + d.costPerSelect * Math.min(d.maxRounds, 2)
  const profiles = profiled * d.costPerProfile
  const contacts = opts.includeContacts && d.contacts ? opts.targetCount * 1.1 * d.costPerContacts : 0
  const context = opts.includeContext ? Math.max(d.contextQuestions, opts.depth === 'quick' ? 3 : 0) * 0.008 : 0
  const expected = discovery + profiles + contacts + context
  // Minutes: ~3 calls in parallel; a profile call ~80s, contact call ~35s, plus verification.
  const profileCalls = Math.ceil(profiled / d.profileBatch)
  const contactCalls = opts.includeContacts && d.contacts ? Math.ceil(opts.targetCount / 3) : 0
  const minutes = Math.ceil((questions * 40 + profileCalls * 85 + contactCalls * 40) / 3 / 60 + opts.targetCount * 0.12 + 3)
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    expectedUsd: round(expected),
    budgetUsd: round(Math.max(0.5, expected * 1.6)),
    minutes,
    breakdown: [
      { label: 'Discovery & selection', usd: round(discovery) },
      { label: `Profiles (~${profiled} companies)`, usd: round(profiles) },
      ...(contacts ? [{ label: 'Contact research', usd: round(contacts) }] : []),
      ...(context ? [{ label: 'Country context', usd: round(context) }] : []),
      { label: 'Contact & link verification', usd: 0 },
    ],
  }
}
