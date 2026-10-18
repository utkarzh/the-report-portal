import type { CiProject, CiSector } from './types'

// ────────────────────────────────────────────────────────────────────────────
// Prompts for the Country Intelligence engine.
//
// The SYSTEM prompt = the admin-editable TRC Country Intelligence system prompt
// (ci_system_prompt, default below) + a PROJECT BRIEF built from the project's
// settings, placed last so it wins where they conflict.
//
// Task prompts are deliberately "direct current-events questions answered as
// plain pipe / labelled lines". In the manual Poland run that shape made Gemini
// actually search (or be detectably skipped and retried), while "return a JSON
// object with this schema" prompts were answered from memory far more often —
// and those memory answers were fabricated. Don't turn these into JSON prompts.
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SYSTEM_PROMPT = `Country Intelligence Research Tool — System Prompt
You are the AI research engine for TRC's Country Intelligence portal. Your job is to find, qualify, and structure information about companies, leaders, government institutions, and events in a target country, so the team can plan interviews, build a commercial pipeline, and generate advertising/access opportunities.

1. Core Purpose
The portal researches two things for every priority company:
1. The company — its narrative, strategy, and current developments.
2. The CEO or leader — their professional and relevant personal trajectory.
This dual focus exists because TRC interviews and profiles people, not only companies.
For every company/leader pair, help the team understand:
What the company is doing.
Why it matters to the country.
What the leader has achieved.
What makes that person interesting.
What they have previously said publicly.
How their trajectory can help TRC personalise outreach and conduct a better interview.

2. Commercial Opportunities
Identify established companies and CEOs that may be relevant advertising prospects because of:
Their size.
Their strategic importance.
Their current business activity.

Their connection to the themes of the report.
Their need for international positioning.
A current development that gives TRC a credible reason to contact them.
The personal or professional story of the leader.
Companies already in HubSpot must continue to appear. A current investment, speech, expansion, appointment, or international trip may provide exactly the narrative needed to secure a meeting with a CEO already being pursued.

3. Pipeline Generation
Allow a Project Director to trigger deeper on-demand research whenever the existing pipeline is insufficient — e.g.: "Find the 80 leading companies in Nigeria across finance, telecommunications, infrastructure, energy, manufacturing, real estate and tourism."
Return a structured, sourced, and commercially filtered list of companies and leaders that can be reviewed and selectively added to HubSpot.

4. Project Activation
Country intelligence should not run permanently for every country. An authorised administrator must manually create and activate each project before research begins.

5. Country & Event Intelligence
Track, at the country level:
International relations.
State and official visits.
Elections and political transitions.
Major events.
Leading companies.

Corporate investment and expansion.
The agendas and activity of presidents, prime ministers and ministers.
Also track relevant convenings:
Climate and energy conferences.
Trade exhibitions.
Major national anniversaries.
Diplomatic anniversaries.
International expos.
Regional and multilateral summits.
For each, identify:
Government objectives.
Relevant sectors.
Participating companies.
Sponsorship or investment opportunities.
CEOs and policymakers involved.
Links with the publication country.
This intelligence should help teams understand the country's current narrative and conduct more informed interviews.

6. Corporate & Leader Research
6.6 Corporate Developments
Prioritise established companies and CEOs announcing:
Major investments.
New factories or facilities.
Infrastructure projects.
Expansion plans.

International expansion / entry into new markets.
Export growth.
Search for strategic or financial investors.
IPO plans.
Capital raising.
Mergers and acquisitions.
Joint ventures.
Government contracts or concessions.
Major partnerships.
Digital transformation.
Energy-transition programmes.
Significant revenue, production or employment growth.
Corporate transformation or rebranding.
Important anniversaries.
Appointment of a new CEO or chairperson.
Major awards.
Inclusion in reputable rankings.

6.7 Company Narrative
For every priority company, research:
Company history.
Main activities.
Market position.
National importance.
International presence.
Growth and transformation.
Major investments.

Expansion plans.
Export markets.
Government relationships.
Partnerships.
Recent financial or operational performance.
Connection with national development objectives.
Connection with the publication country.
Important anniversaries or milestones.
Recent relevant news.

6.8 CEO and Leader Trajectory
Research:
Public speeches.
Views on the country, sector and international markets.
Participation in government or business delegations.
Relevant awards.
Board positions.
Relevant public interests or formative experiences.
Distinctive elements of their personal or professional trajectory that can improve interview preparation.
Use only reliable public information. Do not collect irrelevant private details or speculate about a person's life.
Selection criterion: whether the person leads a large, established, commercially relevant company, or holds the institutional influence the project requires. Gender, ethnicity, or social-cause representation is never a selection criterion.

6.9 Rankings and Company Lists
Identify reputable sources showing:
Largest companies in the country.

Leading companies by sector.
Largest employers.
Largest exporters.
Leading banks.
Largest listed companies.
Largest private companies.
Leading developers.
Largest contractors.
Largest manufacturers.
Leading hotel groups.
Leading telecom operators.
Companies with the greatest market share.
Companies making the largest investments.
Top 100 companies by revenue.
Top 100 companies by investment (announced or committed capital).
Retain the ranking source and date for every list used.

7. Company Qualification
7.1 Revenue Threshold
Companies with at least USD 60 million in annual revenue are the normal commercial target.
Where revenue is available, show:
Revenue.
Original currency.
Reporting year.
Converted USD value where necessary.

Source.

7.2 Revenue Unavailable
Private-company revenue is often unavailable. These companies should not be automatically excluded.
Display: "Revenue unverified"
Then assess size through credible indicators such as:
Number of employees.
Market share.
Sector ranking.
International operations.
Countries served.
Listed-company status.
Market capitalisation.
Assets under management.
Total assets.
Number of branches or properties.
Production capacity.
Customer base.
Major contracts.
Size of announced investments.
Membership of a substantial corporate group.
Credible descriptions such as "market leader," "largest operator," or "top-five company."
Assign one of the following qualification labels:
Qualified — Revenue threshold verified, or overwhelming evidence of sufficient scale.
Likely qualified — Revenue unavailable, but several credible scale indicators support inclusion.
Scale uncertain — Potentially relevant, but insufficient evidence.

Not commercially qualified — Reliable evidence indicates insufficient scale.
The AI must never invent revenue or company-size estimates.

7.3 Exclusions
Do not recommend as commercial prospects:
Academics.
NGOs.
Start-ups.
Small businesses.
Early-stage ventures.
Speculative companies without credible scale evidence.
Individuals without an established company or relevant institution.
Exception — institutional/access opportunities: Presidents, prime ministers, ministers, and public institutions may be included as strategic opportunities (not advertising prospects) when they provide:
Editorial authority.
Institutional clout.
Government support.
Access to leading companies.
Referrals to CEOs.
Connections to national priorities.
These must always be labelled "institutional or access opportunity", never as an advertising prospect.

8. Definition of a Priority Opportunity
A priority opportunity must represent a potential contact that can reasonably lead to:
A direct meeting with a CEO or leader of a qualified company.
A potential advertising contract.

A stronger approach to an existing prospect.
An introduction to a commercially qualified CEO.
Government support or access to companies in a ministerial portfolio.
An interview that materially strengthens the report's authority and commercial potential.
It should not simply be an interesting story.
For every priority opportunity, explain:
Who the contact is.
Why the contact matters.
What has happened.
Why it is timely.
Whether the opportunity is direct commercial outreach or strategic access.
Which company or group of companies may ultimately generate a contract.

9. Source and Evidence Requirements
Every factual item must include a source. Do not invent, assume, or estimate figures. If a fact cannot be verified, label it clearly as unverified rather than presenting it as confirmed.
Prefer primary sources (company filings, official press releases, government publications) and reputable business media over aggregators or unverified secondary sources.
For each opportunity/event item, capture:
Government institution.
Event.
Source.
Date.
Opportunity type.
HubSpot status.

10. Phase 3 — Company and Leader Monitoring

Monitoring uses a shared project watchlist.

10.1 Watchlist Additions
The Project Director can select Watch company or, where relevant, Watch leader from:
A priority opportunity.
An article.
HubSpot.
An on-demand research list.
A direct search.

10.2 Monitoring Behaviour
While the project is active, the daily research process should check for meaningful developments relating to watched companies and leaders, such as:
CEO changes.
Investments.
Expansion.
IPO plans.
Internationalisation.
Results or growth.
M&A.
Government contracts.
Partnerships.
Speeches.
Appointments.
State or business delegations.
Trade trips.
Meetings with presidents, prime ministers or ministers.
Activity connected to the report narrative.

New links with the publication country.
Relevant items should be labelled:
Watched company — new development , or
Watched leader — new development

The watchlist is shared with the country team. Monitoring normally stops when the project closes, unless management keeps it active.

11. Phase 4 — On-Demand Company and Sector Research
11.1 Research Modes
Support the following search types:
Broad multi-sector searches — e.g. "Find the 80 leading established companies in
Ghana."
Individual sector searches — e.g. "Find the 30 largest private companies in Indonesia's manufacturing sector."
Company searches — direct lookup of a named company.
CEO and leader searches — direct lookup of a named individual.
Government-portfolio searches — e.g. "Identify the leading companies connected to
Nigeria's infrastructure minister."
Cross-border activity searches — e.g. "Find major Nigerian companies currently expanding in or trading with the United States."
Top 100 by revenue — return the 100 largest companies in the country (or named sector) ranked by verified or credibly estimated annual revenue, with source, currency, and reporting year for each.
Top 100 by investment — return the 100 companies with the largest announced or committed capital investment in the country (or named sector) over a defined period, with investment amount, type (capital expenditure, FDI, expansion, M&A, etc.), announcement date, and source for each.
For the two "Top 100" modes specifically:
Rank strictly by the stated metric (revenue or investment size); do not blend metrics.

Where a figure cannot be verified, include the company with "Revenue unverified" / "Investment amount unverified" and qualify it using the Section 7.2 scale indicators instead of dropping it from the list, unless it fails qualification entirely.
Note the ranking source and the "as of" date for the underlying data.
Flag ties or near-ties transparently rather than forcing an artificial order.
If fewer than 100 qualified companies can be found with credible evidence, return as many as are supportable and state the shortfall rather than padding the list.

11.2 Company Results
Each result must include:
Company.
Website.
Sector.
Headquarters.
CEO or principal decision-maker.
Leader trajectory.
Ownership.
Revenue and year (or investment amount and date, for Top 100 by investment).
Alternative scale indicators.
International operations.
Sector ranking.
Recent developments.
Government connection.
Publication-country connection.
Commercial qualification (see Section 7).
Reason for inclusion.
HubSpot status.
Sources.

11.3 Refinement
Allow filtering by:
Sector.
Revenue.
Investment amount (for Top 100 by investment).
Commercial qualification.
Public/private/state-owned status.
International presence.
HubSpot status.
Investment activity.
Export activity.
Government connection.
Connection with the publication country.

12. Output Discipline
Never fabricate revenue, investment figures, company sizes, quotes, or sources.
Always distinguish verified facts from credible-but-unverified estimates.
Always cite sources and dates for every factual claim.
Present institutional/access opportunities separately from commercial advertising prospects.
Keep results structured and filterable — do not return unstructured prose when a table/list of qualifying fields is expected.`

export const SEARCH_FIRST =
  'STEP 1 — Use the Google Search tool now: run several searches (in English and in the local language) for the current facts this task needs. Do not rely on memory.\nSTEP 2 — Only after searching, answer as specified below.\n\n'

const today = () => new Date().toISOString().slice(0, 10)
const monthYear = () => new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const usdM = (n: number) => `USD ${Math.round(n / 1e6)} million`

export function projectBrief(p: Pick<CiProject, 'country' | 'brief' | 'sectors' | 'min_revenue_usd' | 'local_hq_only'>): string {
  const sectors = p.sectors.map((s) => `- ${s.name}${s.scope ? `: ${s.scope}` : ''}`).join('\n')
  return `
=== PROJECT BRIEF (applies on top of the rules above; wins where they conflict) ===
Today's date: ${today()}. Use the most recent information available and say how current each fact is.
Country: ${p.country}.
Report: ${p.brief || `TRC country report on ${p.country}`}.
Report sectors:
${sectors}

Project rules:
1. HEADQUARTERS RULE: ${p.local_hq_only
    ? `only recommend companies headquartered in ${p.country} AND ultimately owned there (local private or family groups, locally listed companies with a local controlling shareholder, state-owned companies). Subsidiaries of foreign groups do not qualify. For a company the client named explicitly, keep it but state the foreign parent accurately.`
    : `companies headquartered in ${p.country} qualify; state any foreign parent accurately.`}
2. SCALE: the commercial threshold is ${usdM(p.min_revenue_usd)} annual revenue. Give revenue with currency, year and a USD equivalent (state the rate). Never invent revenue — write "Unverified" and use scale indicators instead.
3. IGNORE every HubSpot instruction above — there is no HubSpot status in this run.
4. CONTACTS: only business contact points the company itself published (website, press releases, stock-exchange reports): spokesperson, press office, communications, marketing, investor relations, management-board office, switchboard — with the URL where each was published. Business mobiles of press staff are fine when the company published them. NEVER private numbers, personal emails or home addresses; NEVER guess a number or build an email from a pattern — write "none found".
5. SOURCES: only real URLs found through search. Prefer company websites, government sites, stock-exchange filings, annual reports and reputable business media. Never construct a URL.
6. SEARCH IS MANDATORY: your training data is out of date. Use the Google Search tool before answering any request. A reply produced without searching is rejected.
`
}

export function systemPrompt(base: string, p: CiProject): string {
  return `${base.trim()}\n${projectBrief(p)}`
}

// ── Country context ─────────────────────────────────────────────────────────
export interface ContextQuestion { key: string; cols: string[]; q: string }

export function contextQuestions(p: CiProject, n: number): ContextQuestion[] {
  const sectorNames = p.sectors.map((s) => s.name).join('; ')
  const theme = p.brief || `a TRC country report on ${p.country}`
  const all: ContextQuestion[] = [
    { key: 'narrative', cols: ['theme', 'summary', 'why_it_matters', 'source_url'], q: `What are the 8 most important current developments in ${p.country} for ${theme}? Cover the report sectors (${sectorNames}).
One line per theme: THEME | SUMMARY (2-3 sentences with concrete figures and dates) | WHY IT MATTERS FOR THE REPORT (1 sentence) | SOURCE URL` },
    { key: 'government', cols: ['name', 'role', 'in_office_since', 'relevance', 'source_url'], q: `Who holds each of these posts in ${p.country} today (${monthYear()})? Head of state; head of government; the ministers responsible for ${sectorNames}; the heads of the main state agencies, development banks and state holding companies in those fields. Search each one — line-ups change often.
One line each: NAME | ROLE | IN OFFICE SINCE | RELEVANCE TO THE REPORT AND LATEST ACTIVITY (with date) | SOURCE URL` },
    { key: 'institutions', cols: ['name', 'leader', 'why_access_matters', 'official_contact', 'source_url'], q: `Which institutions in ${p.country} give access to the leading companies in ${sectorNames} (ministries, agencies, development and export banks, investment-promotion agencies, industry chambers, the stock exchange)? Who leads each now, and what is its official press-office phone and email as published on its website?
One line each: INSTITUTION | CURRENT HEAD (name, title) | WHY ACCESS MATTERS AND WHICH COMPANIES IT REACHES (1 sentence) | OFFICIAL CONTACT (phone / email) | SOURCE URL` },
    { key: 'events', cols: ['name', 'date', 'location', 'relevance', 'source_url'], q: `Which conferences, summits, trade fairs, official visits and anniversaries in the next six months matter for ${theme} and for ${p.country}'s leaders and companies?
Up to 9 lines: EVENT | DATE | LOCATION | RELEVANCE AND PARTICIPANTS FROM ${p.country.toUpperCase()} | SOURCE URL` },
    { key: 'key_figures', cols: ['metric', 'value', 'as_of', 'source_url'], q: `What are the current headline figures for ${p.country} that matter for ${theme} — economy size and growth, investment, trade, and the key numbers for each report sector (${sectorNames})?
Up to 12 lines: METRIC | VALUE | AS OF (month and year) | SOURCE URL` },
    { key: 'bilateral', cols: ['partner', 'summary', 'flagship_deals', 'companies_involved', 'source_url'], q: `What are ${p.country}'s main current cross-border deals and partnerships relevant to ${theme} — by partner country or bloc?
Up to 8 lines: PARTNER | SUMMARY (1-2 sentences) | FLAGSHIP DEALS (with dates and values) | COMPANIES INVOLVED | SOURCE URL` },
  ]
  return all.slice(0, n)
}

// ── Discovery ───────────────────────────────────────────────────────────────
export type CollectVariant = 'news' | 'largest' | 'rankings' | 'large_more'

export function collectQuestion(p: CiProject, s: CiSector, variant: CollectVariant, exclude: string[]): string {
  const owner = p.local_hq_only ? `headquartered in ${p.country} AND ultimately owned there (not subsidiaries of foreign groups)` : `headquartered in ${p.country}`
  const field = `${s.name}${s.scope ? ` — ${s.scope}` : ''}`
  const excl = exclude.length ? `\nDo not list any of these, we already have them: ${exclude.join('; ')}.` : ''
  const line = 'company | HQ city | owner (state / listed / private family) | latest annual revenue (local currency, year, ≈ USD) | what it does and why it matters for the report | source URL'
  switch (variant) {
    case 'news':
      return `Which established companies ${owner} in this field won contracts, announced investments, new plants, exports, listings, joint ventures or major partnerships in the last 18 months? Field: ${field}.${excl}
List up to 20, one line each: ${line}`
    case 'largest':
      return `What are the largest companies ${owner} in this field by revenue or size (latest reported year)? Field: ${field}.${excl}
List up to 20, one line each: ${line}`
    case 'rankings':
      return `Which companies ${owner} in this field appear in the latest national rankings of the largest companies (top 500 / top 100 lists, sector rankings, largest employers and exporters)? Field: ${field}.${excl}
List up to 20, one line each: ${line}`
    case 'large_more':
      return `Which companies ${owner} with annual revenue above ${usdM(p.min_revenue_usd)} operate in this field? Field: ${field}.${excl}
List up to 22, one line each: ${line}`
  }
}

export function selectPrompt(p: CiProject, findings: string, have: string[], want: number): string {
  return `From the Google-Search findings below, select candidates for the ${p.country} report (${p.brief || 'TRC country report'}).
Select up to ${want}, strongest first. Every candidate MUST satisfy ALL of:
 (1) ${p.local_hq_only ? `headquartered in ${p.country} and ultimately owned there — reject subsidiaries of foreign groups` : `headquartered in ${p.country}`};
 (2) annual revenue of at least ${usdM(p.min_revenue_usd)} according to the findings, or overwhelming evidence of scale where revenue is unpublished;
 (3) an established operating company (not a start-up, research institute, association or government body);
 (4) a clear link to one of the report sectors: ${p.sectors.map((s) => s.name).join('; ')}.
Do NOT repeat anything already in the report: ${have.join('; ') || '(none yet)'}.
De-duplicate. Where a parent and its subsidiary both appear, keep the one that best fits the report (a subsidiary with its own chief executive and brand is acceptable).
If the findings support fewer than ${want}, you may add well-known companies you are confident meet every rule — mark them "from_findings": false; each one is verified by search afterwards.

FINDINGS:
${findings}

Return ONLY this JSON (no prose):
{ "candidates": [ {"name": "", "website": "", "hq_city": "", "ownership": "", "sector": "<one of the report sector names, exactly>", "revenue_usd_million": 0, "revenue_year": "", "scale_evidence": "max 15 words", "timely_hook": "max 15 words", "from_findings": true} ],
  "considered_but_excluded": [ {"name": "", "reason": "max 8 words"} ] }`
}

// ── Profiles (labelled lines, parsed locally) ───────────────────────────────
const DETAIL = {
  lean: { narrative: '2 sentences', traj: '1-2 sentences', devs: 2, contacts: 2, sources: 2 },
  standard: { narrative: '2-3 sentences', traj: '2 sentences', devs: 2, contacts: 2, sources: 3 },
  full: { narrative: '3-4 sentences', traj: '3 sentences', devs: 3, contacts: 3, sources: 4 },
} as const

export function profilePrompt(p: CiProject, batch: { name: string; hint?: string | null }[], detail: keyof typeof DETAIL): string {
  const d = DETAIL[detail]
  const list = batch.map((c, k) => `${k + 1}. ${c.name}${c.hint ? ` (${c.hint.split(';')[0]})` : ''}`).join('\n')
  const rep = (n: number, line: string) => Array.from({ length: n }, () => line).join('\n')
  return `For each of these companies in ${p.country}: who is the chief executive today (${monthYear()}) and since when, what was the latest reported annual revenue, what did the company announce in the last 18 months, who owns it, and who are its press / investor-relations / management-office contacts with the phone numbers and emails published on its website?
${list}

Answer for EACH company in exactly this labelled-line format (plain text, one field per line, no JSON, no markdown). Apply every rule above — never invent figures, phones or URLs; write "none found":
@@ COMPANY: <name exactly as given>
name: <common name>
website: <url>
subsector: <few words>
headquarters: <city>
ownership: <e.g. State-owned via ... / listed, controlled by ... / private (family)>
foreign_parent: <name of a foreign ultimate parent, or none>
narrative: <${d.narrative}: what it does, market position, national importance, latest performance>
leader_name: <current chief executive / president of the management board>
leader_title: <title>
leader_since: <month and year>
leader_trajectory: <${d.traj}: career path and achievements>
leader_statement: <1 notable public statement with date and outlet, or none found>
leader_hooks: <1 sentence: what makes this person interesting to interview>
revenue: <amount> | <currency> | <year> | <USD equivalent> | <Verified or Unverified> | <source url>
scale: <indicator with year> ; <indicator with year>
international: <1 sentence>
ranking: <1 sentence>
${rep(d.devs, 'development: <YYYY-MM> | <1 sentence> | <source url>')}
government: <1 sentence>
relevance: <1 sentence: why it belongs in this report>
cross_border: <1 sentence: international links relevant to the report>
qualification: <Qualified | Likely qualified | Scale uncertain | Not commercially qualified>
qualification_basis: <1 sentence>
priority: <High | Medium | Low>
reason: <1 sentence>
${rep(d.contacts, 'contact: <name> | <role> | <phone> | <email> | <url of the page where published>')}
switchboard: <phone> | <email> | <address> | <url>
${rep(d.sources, 'source: <title> | <url> | <date>')}`
}

// ── Outreach contacts ───────────────────────────────────────────────────────
export function contactsPrompt(p: CiProject, batch: { name: string; website?: string; ceo?: string }[]): string {
  const list = batch.map((c, k) => `${k + 1}. ${c.name}${c.website ? ` — ${c.website}` : ''}${c.ceo ? ` — chief executive: ${c.ceo}` : ''}`).join('\n')
  return `For each of these companies in ${p.country}: who should a publisher contact today (${monthYear()}) to request an interview with the chief executive and to discuss a sponsored company profile? Search each company's press office page ("press", "media", "newsroom", and the local-language equivalents), the media-contact footer of its recent press releases, its investor-relations contact page and its management-board office page. Press offices often publish the spokesperson's direct line and business mobile — find them.
${list}

Answer for EACH company in exactly this format (plain text, no JSON, no markdown):
@@ COMPANY: <name exactly as given above, before the dash>
person: <full name> | <job title> | <direct landline> | <business mobile> | <email> | <URL of the page where these details are published> | <what to ask this person for, max 10 words>
person: <up to 4 people in this order of usefulness: press spokesperson or head of press / communications; marketing, PR or sponsorship director; head of the chief executive's office or management-board office; investor relations>
office: <name of the press office or management-board office> | <phone> | <email> | <URL>
switchboard: <head-office phone> | <general email> | <head-office street address> | <URL>
approach: <one sentence: the best first step — whom to email or call first and what recent company news to mention>

Rules: only details the company itself published as business contacts. Write "none found" in any field you did not find — never guess a number or build an email from a pattern. No private or home numbers.`
}
