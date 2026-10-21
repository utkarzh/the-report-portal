import type { CopywritingAnalysis, CopywritingAnalysisEntry, CopywritingCheckItem, CopywritingLengthUnit, CopywritingProjectSection, CopywritingPromptKey } from "@/types";

// ────────────────────────────────────────────────────────────────────────────
// Shared config + parsing helpers for the AI Copywriting Tool. Pure data +
// helpers only (safe to import on server and client) — no lucide/react
// imports, mirrors lib/meeting-prep.ts and lib/documents.ts.
// ────────────────────────────────────────────────────────────────────────────

// Private Storage buckets.
export const PUBLICATION_GUIDES_BUCKET = "copywriting-publication-guides";
export const TRC_GUIDES_BUCKET = "copywriting-trc-guides";
export const PROJECT_DOCUMENTS_BUCKET = "copywriting-project-documents";

// Accepted upload formats, reusing the same extractor as the document-samples
// / research-documents features (see sample-extract.ts).
export const COPYWRITING_UPLOAD_ACCEPT =
  ".docx,.pdf,.xlsx,.xls,.txt,.md,.markdown";
export const COPYWRITING_UPLOAD_EXT_RE =
  /\.(docx|pdf|xlsx|xls|txt|md|markdown)$/i;

export const MAX_PROJECT_DOCUMENTS = 15;
// No per-file cap on source text (long transcripts are read in full), but the
// project's sources TOGETHER go to Claude on every step, and Claude reads at
// most ~1M tokens per request. ~2.4M characters ≈ 600k tokens, leaving room
// for the publication/TRC guides, the stage prompt, the draft and the reply.
export const MAX_PROJECT_SOURCE_CHARS = 2_400_000;
export const MAX_TRC_GUIDES_PER_TYPE = 10;
export const MAX_PUBLICATION_GUIDES = 5;

export const COPYWRITING_PROMPT_KEYS: {
  key: CopywritingPromptKey;
  label: string;
  description: string;
}[] = [
  {
    key: "analyze_sources_styles",
    label: "Analyze Sources & Styles",
    description:
      "Reads every uploaded source plus the TRC guides/examples and publication guide, and extracts style & theme, rules, quotable lines, facts, and information gaps. Each <<<SECTION:NAME>>> marker in this prompt becomes its own section to review (approve or regenerate); with no markers, the five default sections are used.",
  },
  {
    key: "research",
    label: "Research",
    description:
      "Checks a writer-flagged claim against approved outside sources via Gemini, returning a sourced, dated, confidence-rated fact for the research ledger.",
  },
  {
    key: "planning",
    label: "Planning",
    description:
      "Proposes the article thesis, structure, paragraph-by-paragraph plan, quote placement, and length split from approved sources and research.",
  },
  {
    key: "drafting",
    label: "Drafting",
    description:
      "Writes the complete first draft from the approved plan, sources, research, and editorial rules.",
  },
  {
    key: "check",
    label: "Check",
    description:
      "Automated checks: length, quote accuracy, banned words, formatting rules, sourcing, and consistency.",
  },
  {
    key: "revision",
    label: "Revision",
    description:
      "Powers the in-article chat — cuts, restructuring, tone changes, and fact re-checks, applied directly to the draft.",
  },
];

export function isCopywritingPromptKey(v: unknown): v is CopywritingPromptKey {
  return COPYWRITING_PROMPT_KEYS.some((p) => p.key === v);
}

// ── Stage prompt versioning (major.minor, migration 032) ─────────────────
// Every prompt starts at 0.0. A minor update bumps the minor number (0.0 →
// 0.1 → 0.2); a major version bumps the major and resets minor (0.2 → 1.0),
// after which minor updates continue on it (1.1, 1.2…). The label is chosen
// by the admin at save time; the server computes the actual number.
export type PromptVersionBump = "major" | "minor";

export const INITIAL_PROMPT_VERSION = "0.0";

const PROMPT_VERSION_RE = /^(\d+)\.(\d+)$/;

export function parsePromptVersion(
  v: string | null | undefined,
): { major: number; minor: number } {
  const m = PROMPT_VERSION_RE.exec((v || "").trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : { major: 0, minor: 0 };
}

export function comparePromptVersions(a: string, b: string): number {
  const pa = parsePromptVersion(a);
  const pb = parsePromptVersion(b);
  return pa.major - pb.major || pa.minor - pb.minor;
}

// Next label after the HIGHEST existing one (live + every snapshot), so a
// restore or a deleted snapshot can never make a new save reuse a label.
export function nextPromptVersion(
  existing: (string | null | undefined)[],
  bump: PromptVersionBump,
): string {
  const labels = existing.filter((v): v is string => !!v && PROMPT_VERSION_RE.test(v));
  const highest = labels.sort(comparePromptVersions).pop() || INITIAL_PROMPT_VERSION;
  const { major, minor } = parsePromptVersion(highest);
  return bump === "major" ? `${major + 1}.0` : `${major}.${minor + 1}`;
}

export function isPromptVersionBump(v: unknown): v is PromptVersionBump {
  return v === "major" || v === "minor";
}

// Appended after the admin-managed prompt on every Copywriting Claude call —
// mirrors OUTPUT_MARKER in lib/meeting-prep.ts. A literal marker line is a
// parsing contract the model can't talk its way around, unlike a prose
// "don't narrate" instruction.
export const OUTPUT_MARKER = "<<<OUTPUT>>>";

export const NO_PREAMBLE_INSTRUCTION = `Before writing anything else, output the literal line ${OUTPUT_MARKER} on its own line, with nothing before it — no greeting, no plan, no explanation. Immediately after that line, write ONLY the requested output itself: no preamble, no meta-commentary about what you're doing, no closing remarks. Never write things like "Here is..." or "I'll now write...".`;

export function extractAfterMarker(text: string): string {
  const idx = text.indexOf(OUTPUT_MARKER);
  if (idx === -1) return text.trim();
  return text.slice(idx + OUTPUT_MARKER.length).trim();
}

// ── Analyze Sources & Styles: prompt-defined, marker-delimited sections ───
// Same technique as parseResearchSections in lib/meeting-prep.ts — long,
// citation-heavy bodies are fragile to escape into JSON, so a literal marker
// per section is used instead. The SECTIONS themselves are defined by the
// admin's Analyze prompt: every "<<<SECTION:{name}>>>" marker in it becomes a
// section of the review screen, in the order the model writes them. A prompt
// with no markers gets DEFAULT_ANALYSIS_FORMAT appended (the original 5).
// Two keys keep their special behaviour: STYLE_THEME needs no approval (per
// the brief), and GAPS offers its lines for research.
const SECTION_MARKER_RE = /<<<SECTION:\s*([^>\n]+?)\s*>>>/g;

export const DEFAULT_ANALYSIS_SECTIONS: { key: string; label: string; instruction: string }[] = [
  {
    key: "STYLE_THEME",
    label: "Style & Theme",
    instruction:
      "Describe the tone, structure and stylistic approach this article should follow, drawing on the TRC guides/examples for this article type and the publication's own rules.",
  },
  {
    key: "RULES",
    label: "Rules",
    instruction:
      "List the concrete editorial rules that apply (publication additional rules, TRC guide rules, banned words/phrases, formatting requirements) as a bullet list.",
  },
  {
    key: "QUOTABLE_LINES",
    label: "Quotable Lines",
    instruction: "Extract the strongest directly quotable lines from the source material, verbatim, each with its speaker/source noted.",
  },
  {
    key: "FACTS",
    label: "Facts",
    instruction: "List the key verified facts extracted from the source material, each with its source noted.",
  },
  {
    key: "GAPS",
    label: "Gaps",
    instruction:
      "List every information gap: a fact the article will need that is NOT present or NOT sufficiently supported in the uploaded sources. Be specific about what is missing and why it matters for this article.",
  },
];

export const ANALYSIS_UNGATED_KEY = "STYLE_THEME";
export const ANALYSIS_GAPS_KEY = "GAPS";
// Used when the model's reply has no markers at all, so nothing is lost.
const ANALYSIS_FALLBACK_KEY = "ANALYSIS";

// Code-owned, appended to the Analyze prompt only when it defines no
// sections of its own.
export const DEFAULT_ANALYSIS_FORMAT = `Produce your analysis as clearly separated sections, each introduced by its own marker line on its own line (no other text on that line):

${DEFAULT_ANALYSIS_SECTIONS.map((d) => `<<<SECTION:${d.key}>>>\n${d.instruction}`).join("\n\n")}

End your response immediately after the last section with no further commentary.`;

function sameKey(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

// "MARKET_CONTEXT" → "Market Context"; a name written in normal case
// ("Key People") is kept as written. The defaults keep their labels.
export function analysisSectionLabel(key: string): string {
  const known = DEFAULT_ANALYSIS_SECTIONS.find((d) => sameKey(d.key, key));
  if (known) return known.label;
  if (sameKey(key, ANALYSIS_FALLBACK_KEY)) return "Analysis";
  const words = key.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (words !== words.toUpperCase()) return words;
  return words.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// The section names the Analyze prompt defines, in order, without repeats.
export function analysisSectionKeysFromPrompt(promptText: string): string[] {
  const keys: string[] = [];
  for (const m of promptText.matchAll(SECTION_MARKER_RE)) {
    const key = m[1].trim();
    if (key && !keys.some((k) => sameKey(k, key))) keys.push(key);
  }
  return keys;
}

// The Analyze prompt as sent: the admin's prompt, plus the default section
// format when the prompt defines no sections of its own.
export function analyzeSystemPrompt(promptText: string): string {
  return analysisSectionKeysFromPrompt(promptText).length ? promptText : `${promptText}\n\n${DEFAULT_ANALYSIS_FORMAT}`;
}

// Splits the model's reply on its section markers. A marker written in a
// different case from the prompt's ("Gaps" for "GAPS") is filed under the
// prompt's spelling; a repeated marker adds to the same section. A reply with
// no markers becomes one "Analysis" section, so nothing silently disappears.
export function parseAnalysisSections(text: string, promptText = ""): CopywritingAnalysis {
  const declared = analysisSectionKeysFromPrompt(promptText);
  const sections: CopywritingAnalysisEntry[] = [];
  const matches = [...text.matchAll(SECTION_MARKER_RE)];
  for (let i = 0; i < matches.length; i++) {
    const raw = matches[i][1].trim();
    const key = declared.find((k) => sameKey(k, raw)) ?? DEFAULT_ANALYSIS_SECTIONS.find((d) => sameKey(d.key, raw))?.key ?? raw;
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const body = text.slice(start, end).trim();
    if (!body) continue;
    const existing = sections.find((s) => sameKey(s.key, key));
    if (existing) existing.text = `${existing.text}\n\n${body}`;
    else sections.push({ key, label: analysisSectionLabel(key), text: body, approved: false });
  }
  if (sections.length === 0 && text.trim()) {
    sections.push({ key: ANALYSIS_FALLBACK_KEY, label: analysisSectionLabel(ANALYSIS_FALLBACK_KEY), text: text.trim(), approved: false });
  }
  return { sections };
}

const LEGACY_ANALYSIS_FIELDS: [field: "style_theme" | "rules" | "quotable_lines" | "facts" | "gaps", key: string][] = [
  ["style_theme", "STYLE_THEME"],
  ["rules", "RULES"],
  ["quotable_lines", "QUOTABLE_LINES"],
  ["facts", "FACTS"],
  ["gaps", "GAPS"],
];

// Every reader goes through this: an analysis's sections in order, whether
// it was saved in the current shape or the original fixed 5 fields.
export function analysisSectionList(a: CopywritingAnalysis | null | undefined): CopywritingAnalysisEntry[] {
  if (!a) return [];
  if (Array.isArray(a.sections)) return a.sections;
  return LEGACY_ANALYSIS_FIELDS.flatMap(([field, key]) => {
    const sec = a[field];
    return sec?.text ? [{ key, label: analysisSectionLabel(key), text: sec.text, approved: !!sec.approved }] : [];
  });
}

export function findAnalysisSection(a: CopywritingAnalysis | null | undefined, key: string): CopywritingAnalysisEntry | undefined {
  return analysisSectionList(a).find((s) => sameKey(s.key, key));
}

// A copy with one section changed, always in the current shape (so a legacy
// analysis is converted the first time a section is approved or regenerated).
export function updateAnalysisSection(
  a: CopywritingAnalysis | null | undefined,
  key: string,
  change: Partial<Pick<CopywritingAnalysisEntry, "text" | "approved">>,
): CopywritingAnalysis {
  return { sections: analysisSectionList(a).map((s) => (sameKey(s.key, key) ? { ...s, ...change } : s)) };
}

export function isGatedAnalysisSection(key: string): boolean {
  return !sameKey(key, ANALYSIS_UNGATED_KEY);
}

export function isGapsAnalysisSection(key: string): boolean {
  return sameKey(key, ANALYSIS_GAPS_KEY);
}

export function analysisSectionsToPrompt(a: CopywritingAnalysis | null): string {
  const list = analysisSectionList(a);
  if (!list.length) return "(no analysis available)";
  return list.map((s) => `--- ${s.label.toUpperCase()} ---\n${s.text}`).join("\n\n");
}

// Every section except STYLE_THEME carries an individual approve gate (per
// the brief). "All approved" means every OTHER section is approved.
export function analysisAllApproved(a: CopywritingAnalysis | null): boolean {
  const list = analysisSectionList(a);
  return list.length > 0 && list.every((s) => !isGatedAnalysisSection(s.key) || s.approved);
}

// ── Stage machine (11-step brief flow condensed to the state-machine column
// on copywriting_projects — see migration 032) ─────────────────────────────
export const STAGE_LABELS: Record<string, string> = {
  upload: "Upload sources",
  analyzing: "Analyzing sources",
  analysis_review: "Review analysis",
  plan_generating: "Generating plan",
  plan_review: "Review plan",
  drafting: "Drafting",
  draft_review: "Draft & revision",
  complete: "Complete",
  failed: "Failed",
};

// ── Stalled AI steps ──────────────────────────────────────────────────────
// Analyze / Plan / Draft save an in-progress stage before calling Claude. If
// the platform kills the request at its 300s limit, the route's own error
// handling never runs and the stage would stay "in progress" forever. Any
// in-progress stage older than this is treated as stalled: the workspace
// offers a retry and the run route accepts it.
export const STALLED_STAGE_MS = 6 * 60 * 1000;

// In-progress stage → the stage the step was started from.
export const IN_PROGRESS_STAGE_ENTRY: Record<string, string> = {
  analyzing: "upload",
  plan_generating: "analysis_review",
  drafting: "plan_review",
};

export function isStalledStage(project: { stage: string; updated_at: string }, now = Date.now()): boolean {
  return project.stage in IN_PROGRESS_STAGE_ENTRY && now - new Date(project.updated_at).getTime() > STALLED_STAGE_MS;
}

// The animated "flow" shown on the New Project screen and as a progress rail
// inside the workspace.
export const FLOW_STEPS = [
  "Upload",
  "Analyze",
  "Research",
  "Plan",
  "Draft",
  "Review",
] as const;

// Splits the Identified Gaps section into individually-actionable lines (one
// per bullet / sentence) so the writer can send a specific gap to research
// rather than the whole block at once.
// Turns the Identified Gaps section into the "Send to research" checklist:
// only facts, claim sentences and quotes — never headings, image placeholders
// ([IMAGE: …] / [PHOTO: …]), links/source lines or rules. A bullet is kept
// whole (it's one gap); a prose paragraph is split into sentences so each
// claim can be picked individually.
// ── Gaps ↔ Research Ledger ───────────────────────────────────────────────
// Each ledger entry records the exact claim/gap text that was sent to
// research (copywriting_research_entries.requested_claim, migration 041), so
// the analysis screen can drop a gap once its finding is approved or
// discarded. Compared ignoring case, punctuation and spacing.
export function gapKey(text: string): string {
  return (text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Which requested claim each finding answers. Gemini returns one block per
// claim, in order, so equal counts map by position; otherwise each finding is
// matched to the claim it shares the most word stems with (first 5 letters,
// so "appointed" matches "appointment").
export function matchFindingsToClaims(findingClaims: string[], claims: string[]): (string | null)[] {
  if (findingClaims.length === claims.length) return claims.slice();
  if (claims.length === 1) return findingClaims.map(() => claims[0]);
  const words = (t: string) => new Set(gapKey(t).split(" ").filter((w) => w.length > 2).map((w) => w.slice(0, 5)));
  const claimWords = claims.map(words);
  return findingClaims.map((f) => {
    const fw = words(f);
    let best = -1;
    let bestScore = 0;
    claimWords.forEach((cw, i) => {
      const shared = [...fw].filter((w) => cw.has(w)).length;
      const score = shared / Math.max(1, Math.min(fw.size, cw.size));
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    return best >= 0 && bestScore >= 0.2 ? claims[best] : null;
  });
}

// A gap line's research state: none yet, researched and awaiting review, or
// decided (a finding for it was approved or discarded → the gap is resolved).
export function gapResearchState(
  gap: string,
  entries: { requested_claim?: string | null; status: string }[],
): "open" | "pending" | "resolved" {
  const key = gapKey(gap);
  const mine = entries.filter((e) => e.requested_claim && gapKey(e.requested_claim) === key);
  if (!mine.length) return "open";
  return mine.some((e) => e.status === "approved" || e.status === "rejected") ? "resolved" : "pending";
}

export function splitGapLines(gapsText: string | undefined): string[] {
  if (!gapsText) return [];
  const out: string[] = [];
  for (const rawLine of gapsText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) continue; // markdown heading
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue; // horizontal rule
    if (/^\|/.test(line)) continue; // table row
    if (/^\*\*[^*]+\*\*:?$/.test(line) || /^__[^_]+__:?$/.test(line)) continue; // whole-line bold = heading

    const isListItem = /^([-*•]|\d+[.)])\s+/.test(line);
    const body = stripInlineMarkdown(line.replace(/^([-*•]|\d+[.)])\s+/, ""))
      .replace(/\[(?:IMAGE|PHOTO|PICTURE|IMAGE CAPTION|CAPTION|GRAPHIC|INFOGRAPHIC)\b[^\]]*\]/gi, "")
      .trim();
    if (!body) continue;

    const candidates = isListItem ? [body] : splitSentences(body);
    for (const c of candidates) {
      if (isResearchableGap(c)) out.push(c);
    }
  }
  return Array.from(new Set(out));
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // markdown image
    .replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, "$1") // link → its text
    .replace(/(\*\*\*|\*\*|\*|__|`)(.+?)\1/g, "$2")
    .trim();
}

// Sentence split that keeps a closing quote mark with its sentence.
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?]["”’']?)\s+(?=["“‘A-Z0-9])/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function isResearchableGap(text: string): boolean {
  if (/https?:\/\/|www\./i.test(text)) return false; // link / source line
  if (/^(source|sources|reference|references|link|url|image|photo|caption)s?\s*[:\-–]/i.test(text)) return false;
  if (/^\[.*\]$/.test(text)) return false; // any other bracketed placeholder
  const hasQuote = /["“”]/.test(text);
  const words = text.split(/\s+/).length;
  // Headings without markdown ("Into the Highland Valleys") are short and
  // unpunctuated; real facts, claims and quotes are sentences.
  if (!hasQuote && words < 6 && !/[.!?]$/.test(text)) return false;
  return words >= 3;
}

// Default automated-check item labels — used to render a "not yet run" state
// before the writer has triggered the Check stage.
export const CHECK_ITEM_LABELS = [
  "Word / length count",
  "Quotes match source exactly",
  "Banned words or phrases",
  "Publication formatting rules",
  "Sourcing",
  "Overall consistency",
];

// Builds the block of shared reference material (TRC house rules /
// publication guide / TRC guides & examples for the chosen article type)
// that is appended to every Claude call for a project — the writer never
// selects these manually (brief: "it automatically applies... the writer
// never has to select these manually").
export function buildReferenceBlock(opts: {
  publicationName: string;
  publicationCountry?: string | null;
  publicationRules?: string;
  publicationGuideTexts?: string[];
  articleTypeName: string;
  articleTypeInstructions?: string;
  trcGuideTexts?: string[];
  trcExampleTexts?: string[];
}): string {
  const parts: string[] = [];
  parts.push(
    `--- PUBLICATION: ${opts.publicationName}${opts.publicationCountry ? ` (${opts.publicationCountry})` : ""} ---`,
  );
  if (opts.publicationRules?.trim())
    parts.push(
      `Additional rules for this publication:\n${opts.publicationRules.trim()}`,
    );
  if (opts.publicationGuideTexts?.length) {
    parts.push(
      `Publication style guide(s):\n${opts.publicationGuideTexts.join("\n\n---\n\n")}`,
    );
  }
  parts.push(`\n--- ARTICLE TYPE: ${opts.articleTypeName} ---`);
  if (opts.articleTypeInstructions?.trim())
    parts.push(opts.articleTypeInstructions.trim());
  if (opts.trcGuideTexts?.length) {
    parts.push(
      `TRC guides for this article type:\n${opts.trcGuideTexts.join("\n\n---\n\n")}`,
    );
  }
  if (opts.trcExampleTexts?.length) {
    parts.push(
      `Approved TRC worked examples for this article type (match this standard):\n${opts.trcExampleTexts.join("\n\n---\n\n")}`,
    );
  }
  return parts.join("\n\n");
}

export function buildSourcesBlock(
  docs: { filename: string; extracted_text: string }[],
): string {
  if (!docs.length) return "(no source documents uploaded)";
  return docs
    .map((d) => `--- SOURCE: ${d.filename} ---\n${d.extracted_text}`)
    .join("\n\n");
}

export function buildApprovedResearchBlock(
  entries: {
    claim: string;
    source_url: string | null;
    publication_date: string | null;
    caveats: string | null;
    confidence: string | null;
  }[],
): string {
  const approved = entries;
  if (!approved.length) return "(no verified research yet)";
  return approved
    .map(
      (e, i) =>
        `${i + 1}. ${e.claim}${e.source_url ? ` [source: ${e.source_url}]` : ""}${e.publication_date ? ` (published ${e.publication_date})` : ""}${e.confidence ? ` — confidence: ${e.confidence}` : ""}${e.caveats ? `\n   Caveat: ${e.caveats}` : ""}`,
    )
    .join("\n");
}

export function buildRequestBlock(project: {
  editorial_objective: string;
  section_structure: string;
  target_length: number | null;
  quotes_required: number | null;
  sections?: CopywritingProjectSection[] | null;
  direct_quotes?: number | null;
  pull_quotes?: number | null;
  image_count?: number | null;
}): string {
  const n = project.image_count;
  const images =
    n === null || n === undefined
      ? "\nImages: (not specified — decide from the article type, publication and guides whether this article needs photos, and how many)"
      : n === 0
        ? "\nImages: none"
        : `\nImages: ${n} (the article carries exactly ${n} numbered photo placeholder${n === 1 ? "" : "s"}; plan where each one goes)`;
  const sections = project.sections || [];
  // Projects configured before migration 041 keep their original free-text
  // structure / word target / single quote count.
  if (!sections.length) {
    return `--- ARTICLE REQUEST ---
Editorial objective: ${project.editorial_objective || "(not specified)"}
Section structure: ${project.section_structure || "(not specified — propose a sensible structure)"}
Target length: ${project.target_length ? `${project.target_length} words` : "(not specified)"}
Quotes required: ${project.quotes_required ?? "(not specified)"}${images}`;
  }
  const totals = sectionTotals(sections);
  const direct = project.direct_quotes ?? 0;
  const pull = project.pull_quotes ?? 0;
  return `--- ARTICLE REQUEST ---
Editorial objective: ${project.editorial_objective || "(not specified)"}
Section structure (fixed by the writer, in this order — target length of each section in characters (spaces included) or in words, as stated):
${sections.map((sec, i) => `${i + 1}. ${sec.name} — ${formatLength(sectionTarget(sec).value, sectionTarget(sec).unit)}${sectionDescriptionSuffix(sec)}`).join("\n")}
Total: ${totals.label}
Direct quotes: ${direct} (exact words of a person or source, word for word from the uploaded sources, in quotation marks)
Pull quotes: ${pull} (short attention-grabbing excerpts copied word for word from the uploaded sources, shown as highlights)${images}`;
}

// ── Image slots ──────────────────────────────────────────────────────────
// Every article type can set a number of images at configure time:
//   • blank (null) → the model decides from the prompts/guides/article type
//                    whether the article needs photos, and how many;
//   • 0            → no images;
//   • N            → exactly N.
// Photos go in as numbered "[IMAGE n: description]" lines, and the writer
// uploads a photo into each slot (copywriting_project_images, migration 032).
// Slots are keyed by NUMBER so a revision that rewrites a description keeps
// the photo already placed there.
export const COPYWRITING_IMAGES_BUCKET = "copywriting-images";
export const MAX_IMAGE_COUNT = 20;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const COPYWRITING_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";
// Stored photos are JPG/PNG only — the formats Word (docx ImageRun) and the
// PDF renderer can embed. The browser converts a WebP to JPG before upload,
// so the picker still accepts WebP.
export const COPYWRITING_IMAGE_EXT_RE = /\.(jpe?g|png)$/i;
export const COPYWRITING_IMAGE_PICK_EXT_RE = /\.(jpe?g|png|webp)$/i;

// Highest slot number a writer can upload into: the configured count, or the
// hard cap when the model decides the count (null), 0 when images are off.
export function maxUploadableSlot(imageCount: number | null | undefined): number {
  if (imageCount === null || imageCount === undefined) return MAX_IMAGE_COUNT;
  return Math.max(0, Math.min(imageCount, MAX_IMAGE_COUNT));
}

// Code-owned, appended last to the drafting and revision calls (so it wins
// over the admin prompt). Always sent, so placeholders — whether the model
// chose them or the writer asked for a number — arrive in one parseable shape.
export function imagePlaceholderInstruction(count: number | null | undefined): string {
  const format = `each on its own line, separated from the text by blank lines, numbered from 1 in reading order, in exactly this form:
[IMAGE 1: one-sentence description of the photo]
[IMAGE 2: one-sentence description of the photo]
Never repeat a number and never write anything else inside the brackets. When revising, keep every existing placeholder and its number (you may move it or reword its description).`;
  if (count === 0) {
    return "IMAGE SLOTS: The writer has asked for no images in this article — do not include any image or photo placeholders.";
  }
  if (count === null || count === undefined) {
    return `IMAGE SLOTS: Decide from the article type, the publication's rules and the guides whether this article should carry photos, and how many (at most ${MAX_IMAGE_COUNT}). If it should, mark where each photo goes with a placeholder — ${format}
If it should not, include no placeholders.`;
  }
  return imagePlaceholderInstructionExact(count);
}

function imagePlaceholderInstructionExact(count: number): string {
  const examples = Array.from({ length: Math.min(count, 3) }, (_, i) => `[IMAGE ${i + 1}: one-sentence description of the photo]`).join("\n");
  return `IMAGE SLOTS: The writer has asked for exactly ${count} image${count === 1 ? "" : "s"} in this article. Place exactly ${count} image placeholder${count === 1 ? "" : "s"} in the article where the photos should appear — each on its own line, separated from the text by blank lines, numbered 1 to ${count} in reading order, in exactly this form:
${examples}
Never add more or fewer than ${count}, never repeat a number, and never write anything else inside the brackets. When revising, keep every placeholder and its number (you may move it or reword its description).`;
}

// ── Section structure & quotes (migration 041) ───────────────────────────
// The writer builds the article from admin-managed section names and gives
// each one a length in characters (spaces included); they also set how many
// direct quotes and pull quotes it carries. The model marks where each
// section starts with a "[SECTION n: Name]" line and writes each pull quote
// as a "[PULL QUOTE: …]" line. Both are structure, not article text: the UI
// and the Word/PDF exports never print the section markers, and render pull
// quotes as highlights. Lengths and quote counts are MEASURED IN CODE from
// those markers — never asked of the model, which can't count characters.
export const MAX_ARTICLE_SECTIONS = 20;
// No length limit: the writer decides how long each section is. A draft
// longer than one step can write in time is saved as far as it got, and its
// check report says it's incomplete (see the run route's streamWriter).
export const MAX_QUOTES = 20;
// For the "about N words" hint only (English averages ~6 characters a word
// with its space).
export const CHARS_PER_WORD = 6;
// A section is on target within ±10% (or ±25 characters / ±2 words for very
// short ones — a headline set in words needs to be close).
const SECTION_TOLERANCE = 0.1;
const SECTION_TOLERANCE_MIN: Record<CopywritingLengthUnit, number> = { characters: 25, words: 2 };

export const MAX_SECTION_NAME_LENGTH = 80;
export const MAX_SECTION_DESCRIPTION_LENGTH = 600;

// A section description from a request body: trimmed, inner line breaks kept.
export function normalizeSectionDescription(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : "";
}

// Same rule as the table's unique index: surrounding and repeated spaces
// don't make a different section.
export function normalizeSectionName(name: unknown): string {
  return typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
}

// The admin's definition of a section label ("TEXT" → "the article's main
// body…"), after the section in the request/structure lists, so the model
// knows what each label stands for. One line, so the list stays readable.
function sectionDescriptionSuffix(sec: { description?: string }): string {
  const d = (sec.description || "").replace(/\s+/g, " ").trim();
  return d ? `. What this section is: ${d}` : "";
}

export function formatChars(n: number): string {
  return n.toLocaleString("en-US");
}

// Each section's length is set in characters (spaces included) or in words,
// chosen per section on the Configure form; characters by default. Early
// snapshots stored only `target_chars`.
export function sectionTarget(sec: { unit?: CopywritingLengthUnit; target?: number; target_chars?: number }): { value: number; unit: CopywritingLengthUnit } {
  const unit: CopywritingLengthUnit = sec.unit === "words" ? "words" : "characters";
  return { value: Math.max(0, Number(sec.target ?? sec.target_chars) || 0), unit };
}

// "600 characters", "1 word".
export function formatLength(value: number, unit: CopywritingLengthUnit): string {
  return `${formatChars(value)} ${unit === "words" ? (value === 1 ? "word" : "words") : value === 1 ? "character" : "characters"}`;
}

// A section's target in characters (words × CHARS_PER_WORD) — for sizing the
// output budget and the "about N words / characters" hints only.
export function approxSectionChars(sec: { unit?: CopywritingLengthUnit; target?: number; target_chars?: number }): number {
  const t = sectionTarget(sec);
  return t.unit === "words" ? t.value * CHARS_PER_WORD : t.value;
}

// Totals per unit: "3,000 characters + 400 words" when sections mix units.
export function sectionTotals(sections: { unit?: CopywritingLengthUnit; target?: number; target_chars?: number }[]): {
  characters: number;
  words: number;
  approxChars: number;
  label: string;
} {
  let characters = 0;
  let words = 0;
  for (const sec of sections) {
    const t = sectionTarget(sec);
    if (t.unit === "words") words += t.value;
    else characters += t.value;
  }
  const parts = [characters ? formatLength(characters, "characters") : "", words ? formatLength(words, "words") : ""].filter(Boolean);
  return { characters, words, approxChars: characters + words * CHARS_PER_WORD, label: parts.join(" + ") || formatLength(0, "characters") };
}

// Output budget for a draft or a full revision: the configured length plus
// room for markers, gap list and headings (~3 characters per token, which
// errs high for English), up to the model's 64k output maximum. The calls
// are streamed, so a large budget is fine; the time limit is enforced by the
// route's soft deadline instead.
export function draftMaxTokens(sections: CopywritingProjectSection[] | null | undefined): number {
  const total = sectionTotals(sections || []).approxChars;
  if (!total) return 8000;
  return Math.min(64_000, Math.max(8000, Math.ceil(total / 3) + 3000));
}

const SECTION_LINE_RE = /^\s*\[\s*SECTION\s*#?\s*(\d+)?\s*[:\-–]\s*([^\]]*?)\s*\]\s*$/i;
// Put between sections by labelSectionsForOutput(): two blank lines in the
// final article view, Copy, Word and PDF.
export const SECTION_BREAK_LINE = "[SECTION BREAK]";
const SECTION_BREAK_RE = /^\s*\[SECTION BREAK\]\s*$/;
const PULL_QUOTE_LINE_RE = /^\s*\[\s*PULL[\s-]*QUOTE\s*#?\s*\d*\s*[:\-–]\s*([\s\S]*?)\s*\]\s*$/i;

function quoteRule(direct: number, pull: number): string {
  const directRule =
    direct > 0
      ? `DIRECT QUOTES: Include exactly ${direct} direct quote${direct === 1 ? "" : "s"} — the exact words a person or source said or wrote, reproduced word for word from the uploaded sources, inside quotation marks and attributed to the speaker or source in the sentence. Never paraphrase or tidy anything inside quotation marks, never invent a quote, and don't use quotation marks for anything else (titles go in italics).`
      : "DIRECT QUOTES: Include no direct quotes — report what people said in your own words, without quotation marks.";
  const pullRule =
    pull > 0
      ? `PULL QUOTES: Include exactly ${pull} pull quote${pull === 1 ? "" : "s"} — each a short, attention-grabbing excerpt (one or two sentences, at most about 30 words) copied word for word from the uploaded source documents. Put each one on its own line, separated from the text by blank lines, inside the section it belongs to, in exactly this form:
[PULL QUOTE: the excerpt, word for word]
No quotation marks or attribution inside the brackets. Pull quotes are displayed as highlights beside the text and don't count toward a section's length.`
      : "PULL QUOTES: Include no pull quotes and no [PULL QUOTE: …] lines.";
  return `${directRule}\n\n${pullRule}`;
}

// Code-owned, appended last to the drafting and revision calls (so it wins
// over the admin prompt). Only for projects configured with a structure.
export function structureInstruction(project: {
  sections?: CopywritingProjectSection[] | null;
  direct_quotes?: number | null;
  pull_quotes?: number | null;
}): string {
  const sections = project.sections || [];
  if (!sections.length) return "";
  const list = sections
    .map((sec, i) => `[SECTION ${i + 1}: ${sec.name}] — about ${formatLength(sectionTarget(sec).value, sectionTarget(sec).unit)}${sectionDescriptionSuffix(sec)}`)
    .join("\n");
  const described = sections.some((sec) => sec.description?.trim());
  return `ARTICLE STRUCTURE (set by the writer — follow it exactly):
The article has exactly ${sections.length} section${sections.length === 1 ? "" : "s"}, in this order. Start each section with its marker line, on its own line with a blank line before and after, written exactly as shown:
${list}
The markers are not article text: the system hides them and measures each section from them.${described ? " A section's name is a label; where it is followed by \"What this section is:\", that definition says what the label means for this article (for example, which part of the article it is and what kind of text goes in it). Write exactly that kind of text in that section, and nothing that belongs to another section." : ""} Write each section to its target length, in the unit stated for it — characters (spaces included) or words — counting only that section's own text (±10% is fine). If the article has a headline and no section is defined as the headline, put it before the first marker. Don't print the section names as headings: add a heading inside a section only when the section's definition, the publication or the article type calls for one, worded for the reader.
Never add, drop, merge, rename, reorder or renumber sections. When revising, keep every marker exactly as it is, even when the writer asks you to change what a section says.

${quoteRule(project.direct_quotes ?? 0, project.pull_quotes ?? 0)}`;
}

// Appended to the planning calls: the plan follows the fixed structure.
export function planStructureInstruction(project: {
  sections?: CopywritingProjectSection[] | null;
  direct_quotes?: number | null;
  pull_quotes?: number | null;
}): string {
  const sections = project.sections || [];
  if (!sections.length) return "";
  const direct = project.direct_quotes ?? 0;
  const pull = project.pull_quotes ?? 0;
  return `ARTICLE STRUCTURE: The writer has fixed the article's sections and their lengths (see the ARTICLE REQUEST). Plan section by section, in that order, using exactly those sections: give each its name and target length (in the unit stated for it), what it covers (as the section's definition says, where it has one — \"What this section is: …\"), and which direct quotes and pull quotes go in it. Don't add, drop, merge or reorder sections. Plan exactly ${direct} direct quote${direct === 1 ? "" : "s"} (the exact words of a person or source, word for word from the uploaded sources, with the speaker) and exactly ${pull} pull quote${pull === 1 ? "" : "s"} (short, attention-grabbing excerpts copied word for word from the uploaded sources), quoting each one in full in the plan.`;
}

// How the writer's brief and the TRC references divide the work. Code-owned
// and appended after the structure instruction on Plan/Replan (stage
// "plan") and Draft/Revision ("write"), so an admin prompt edit can't lose it:
//   • the writer's section structure decides WHAT the article contains, and
//     always wins;
//   • the TRC guides and worked examples decide HOW each part is written;
//   • with no section structure (projects configured before migration 041),
//     the worked examples also serve as the model for the article's shape;
//   • facts only ever come from the sources and the approved research.
// Empty when the article type has no TRC guides or examples.
export function referenceUsageInstruction(opts: {
  hasSections: boolean;
  hasTrcReferences: boolean;
  stage: "plan" | "write";
}): string {
  if (!opts.hasTrcReferences) return "";
  const how =
    "how the opening hooks the reader, paragraph rhythm, how quotes are introduced, transitions, tone, and how the closing lands";
  const lines = opts.hasSections
    ? [
        "- WHAT the article contains — its sections, their order, their length and the quotes it must carry — is decided by the writer's section structure and settings in the ARTICLE REQUEST. It always wins.",
        `- HOW each section is written — ${how} — follows the TRC guides and approved worked examples for this article type. Match their standard.`,
        "- When an example is organised differently from the writer's structure, keep the writer's structure and apply the example's way of writing inside it.",
      ]
    : [
        "- No section structure was set for this article, so take its shape — how many parts, their order and the proportions between them — from the TRC worked examples and guides for this article type, adapted to this material.",
        `- Write each part to their standard: ${how}.`,
      ];
  lines.push(
    "- Facts, names, figures and quotes come only from the uploaded sources and the approved research — never from the TRC guides or examples.",
  );
  lines.push(
    opts.stage === "plan"
      ? "- For each section of the plan, note in a few words which TRC technique it uses (for example: \"opens with a scene, then the key figure, as in the worked examples\")."
      : "- Where the approved plan names a TRC technique for a section, use it.",
  );
  return `HOW TO USE THE WRITER'S BRIEF AND THE TRC REFERENCES:\n${lines.join("\n")}`;
}

// Characters a reader sees: markdown syntax removed, every run of
// whitespace (line breaks included) counted as one space.
export function plainCharCount(markdown: string): number {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, " ")
    .replace(/(\*\*\*|\*\*|\*|__|_|`)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).length;
}

// Words a reader sees: the same plain text, split on whitespace.
export function plainWordCount(markdown: string): number {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*\*|\*\*|\*|__|_|`)(.+?)\1/g, "$2");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export interface SectionMeasure {
  key: string;
  name: string;
  unit: CopywritingLengthUnit;
  target: number;
  /** Length measured in the draft, in `unit`; null when its marker is missing. */
  actual: number | null;
}

interface DraftParts {
  markers: { number: number | null; name: string; text: string }[];
  pullQuotes: string[];
  /** Article text outside markers, image slots and pull quotes. */
  body: string;
}

function splitDraftParts(markdown: string): DraftParts {
  const markers: DraftParts["markers"] = [];
  const sectionLines: string[][] = [];
  const pullQuotes: string[] = [];
  const bodyLines: string[] = [];
  for (const line of (markdown || "").replace(/\r\n/g, "\n").split("\n")) {
    const sec = SECTION_LINE_RE.exec(line);
    if (sec) {
      markers.push({ number: sec[1] ? Number(sec[1]) : null, name: sec[2].trim(), text: "" });
      sectionLines.push([]);
      continue;
    }
    const pq = PULL_QUOTE_LINE_RE.exec(line);
    if (pq) {
      pullQuotes.push(pq[1].trim());
      continue;
    }
    if (IMAGE_LINE_RE.test(line)) continue;
    bodyLines.push(line);
    sectionLines[sectionLines.length - 1]?.push(line);
  }
  markers.forEach((m, i) => (m.text = sectionLines[i].join("\n")));
  return { markers, pullQuotes, body: bodyLines.join("\n") };
}

// Each configured section's measured length, matched to the draft's markers
// by number (falling back to position when a marker has no number).
export function measureSections(markdown: string, sections: CopywritingProjectSection[]): SectionMeasure[] {
  const { markers } = splitDraftParts(markdown);
  return sections.map((sec, i) => {
    const marker = markers.find((m) => m.number === i + 1) ?? (markers[i] && markers[i].number === null ? markers[i] : undefined);
    const { value, unit } = sectionTarget(sec);
    const actual = marker ? (unit === "words" ? plainWordCount(marker.text) : plainCharCount(marker.text)) : null;
    return { key: sec.key, name: sec.name, unit, target: value, actual };
  });
}

export function sectionLengthStatus(target: number, actual: number | null, unit: CopywritingLengthUnit = "characters"): "ok" | "near" | "off" | "missing" {
  if (actual === null) return "missing";
  const diff = Math.abs(actual - target);
  const tolerance = Math.max(target * SECTION_TOLERANCE, SECTION_TOLERANCE_MIN[unit]);
  if (diff <= tolerance) return "ok";
  if (diff <= tolerance * 2) return "near";
  return "off";
}

function signedPercent(target: number, actual: number): string {
  const pct = Math.round(((actual - target) / target) * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)}%`;
}

// Word-for-word comparison that ignores case, punctuation, curly vs straight
// quotes and spacing — the differences a faithful quote may still have.
function normalizeForQuote(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

// Each piece of a quote between ellipses / [inserted words] must appear in
// the sources; pieces under three words are too short to judge.
function foundInSources(quote: string, normalizedSources: string): boolean {
  const pieces = quote
    .split(/\.{3}|…|\[[^\]]*\]/)
    .map((p) => normalizeForQuote(p))
    .filter((p) => p.trim().split(" ").length >= 3);
  if (!pieces.length) return true;
  return pieces.every((p) => normalizedSources.includes(p));
}

// Quoted passages of four words or more: shorter ones are usually scare
// quotes or names ("smart city"), not someone's words.
function findDirectQuotes(body: string): string[] {
  const text = body.replace(/^\s{0,3}#{1,6}\s+.*$/gm, " ");
  const quotes: string[] = [];
  const re = /[“"]([^“”"\n]+?)[”"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const q = m[1].trim();
    if (q.split(/\s+/).length >= 4) quotes.push(q);
  }
  return quotes;
}

function clip(text: string, max = 70): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// The structure items of the check report, measured in code and shown
// alongside the model's own checks: section order, section lengths, and
// the number and source-fidelity of direct and pull quotes.
export function structureCheckItems(
  draft: string,
  project: { sections?: CopywritingProjectSection[] | null; direct_quotes?: number | null; pull_quotes?: number | null },
  sourceTexts: string[],
): CopywritingCheckItem[] {
  const sections = project.sections || [];
  if (!sections.length) return [];
  const items: CopywritingCheckItem[] = [];
  const parts = splitDraftParts(draft);
  const measures = measureSections(draft, sections);

  const missing = measures.filter((m) => m.actual === null);
  const extra = parts.markers.length - (sections.length - missing.length);
  items.push(
    missing.length
      ? { label: "Section structure", result: "fail", detail: `Missing section marker${missing.length === 1 ? "" : "s"}: ${missing.map((m) => m.name).join(", ")}.` }
      : extra > 0
        ? { label: "Section structure", result: "warning", detail: `All ${sections.length} sections are present, plus ${extra} extra section marker${extra === 1 ? "" : "s"}.` }
        : { label: "Section structure", result: "pass", detail: `All ${sections.length} sections present, in order.` },
  );

  const measured = measures.filter((m) => m.actual !== null) as (SectionMeasure & { actual: number })[];
  const off = measured.filter((m) => sectionLengthStatus(m.target, m.actual, m.unit) === "off");
  const near = measured.filter((m) => sectionLengthStatus(m.target, m.actual, m.unit) === "near");
  const describe = (list: typeof measured) =>
    list.map((m) => `${m.name} ${formatChars(m.actual)} / ${formatLength(m.target, m.unit)} (${signedPercent(m.target, m.actual)})`).join("; ");
  const actualTotals = sectionTotals(measured.map((m) => ({ unit: m.unit, target: m.actual })));
  if (measured.length) {
    items.push(
      off.length
        ? { label: "Section lengths", result: "fail", detail: describe([...off, ...near]) }
        : near.length
          ? { label: "Section lengths", result: "warning", detail: describe(near) }
          : {
              label: "Section lengths",
              result: "pass",
              detail: `Every section within ±10% of its target (${actualTotals.label} written, against ${sectionTotals(sections).label}).`,
            },
    );
  }

  const normalizedSources = normalizeForQuote(sourceTexts.join("\n"));
  // A wrong count of pull quotes is exact (they're marked lines); direct
  // quotes are found by quotation marks, so a count mismatch is only a
  // warning. A quote that isn't word for word in the sources always fails.
  const quoteItem = (label: string, wanted: number, found: string[], exactCount: boolean): CopywritingCheckItem => {
    const notInSources = found.filter((q) => !foundInSources(q, normalizedSources));
    const fidelity = notInSources.length
      ? ` Not found word for word in the sources: ${notInSources.map((q) => `“${clip(q)}”`).join("; ")}.`
      : found.length
        ? " All found word for word in the sources."
        : "";
    const result: CopywritingCheckItem["result"] = notInSources.length
      ? "fail"
      : found.length === wanted
        ? "pass"
        : exactCount
          ? "fail"
          : "warning";
    return { label, result, detail: `${found.length} of ${wanted} required.${fidelity}` };
  };
  items.push(quoteItem("Direct quotes", project.direct_quotes ?? 0, findDirectQuotes(parts.body), false));
  items.push(quoteItem("Pull quotes", project.pull_quotes ?? 0, parts.pullQuotes, true));
  return items;
}

// The measurements handed to the Check model under "MEASURED BY THE
// SYSTEM", so its own report (length tables, quote checks) uses real numbers
// instead of the model's estimates — a model can't count characters. Same
// numbers as structureCheckItems() shows on screen.
export function structureMeasurementsForCheck(
  draft: string,
  project: { sections?: CopywritingProjectSection[] | null; direct_quotes?: number | null; pull_quotes?: number | null },
  sourceTexts: string[],
): string {
  const sections = project.sections || [];
  if (!sections.length) return "";
  const parts = splitDraftParts(draft);
  const measures = measureSections(draft, sections);
  const normalizedSources = normalizeForQuote(sourceTexts.join("\n"));
  const lines = [
    "--- MEASURED BY THE SYSTEM (exact — use these numbers; never count characters yourself) ---",
    "Section lengths, each in its own unit — characters (spaces included) or words — counting only that section's own text (markers, image slots and pull quotes excluded). ±10% of the target counts as on target:",
    ...measures.map((m, i) => {
      if (m.actual === null) return `${i + 1}. ${m.name}: MISSING (no [SECTION ${i + 1}: …] marker in the draft) — target ${formatLength(m.target, m.unit)}`;
      const diff = m.actual - m.target;
      return `${i + 1}. ${m.name}: ${formatChars(m.actual)} of ${formatLength(m.target, m.unit)} (${diff >= 0 ? "+" : "−"}${formatChars(Math.abs(diff))}, ${signedPercent(m.target, m.actual)})`;
    }),
    `Total: ${sectionTotals(measures.map((m) => ({ unit: m.unit, target: m.actual ?? 0 }))).label} of ${sectionTotals(sections).label}`,
    "",
    `Pull quotes required: ${project.pull_quotes ?? 0}; found: ${parts.pullQuotes.length}.`,
    ...parts.pullQuotes.map((q, i) => `${i + 1}. “${clip(q, 140)}” — ${foundInSources(q, normalizedSources) ? "found word for word in the uploaded sources" : "NOT found word for word in the uploaded sources"}`),
    "",
    `Direct quotes required: ${project.direct_quotes ?? 0}; quoted passages of four or more words found in the text: ${findDirectQuotes(parts.body).length}.`,
    ...findDirectQuotes(parts.body).map((q, i) => `${i + 1}. “${clip(q, 140)}” — ${foundInSources(q, normalizedSources) ? "found word for word in the uploaded sources" : "NOT found word for word in the uploaded sources"}`),
  ];
  return lines.join("\n");
}

// Whether a refine-chat reply is a full article (which replaces the draft)
// or a conversational reply, such as a clarifying question, which stays in
// the chat and leaves the draft as it is. A configured article must contain
// every one of its [SECTION n: …] markers (sections are fixed, so a real
// revision always has them all); any reply far shorter than the current
// draft is treated as conversation.
export function isFullArticleReply(
  reply: string,
  currentDraft: string | null | undefined,
  sections: CopywritingProjectSection[] | null | undefined,
): boolean {
  if (!reply.trim()) return false;
  const expected = (sections || []).length;
  if (expected && splitDraftParts(reply).markers.length < expected) return false;
  const before = plainCharCount(currentDraft || "");
  if (before > 400 && plainCharCount(reply) < before * 0.25) return false;
  return true;
}

// The finished article in TRC's handover format, as in the worked examples:
// each "[SECTION n: Name]" marker becomes a visible label with the section's
// measured length against its target, sections separated by two blank lines
// (a SECTION_BREAK_LINE) —
//   **TITLE (20/21 CHARS):** Jollibee goes global
//   **TEXT (2,473/2,480 CHARS):**   (then the section's paragraphs)
// A one-paragraph section goes on the label's line; anything longer (several
// paragraphs, a pull quote, an image) starts on the next line. Names come
// from the article's section structure, in capitals, numbered when one is
// used more than once ("QUOTE 1", "QUOTE 2"). Counts are measured in code
// (measureSections), never by the model. Used by the final article view,
// Copy, Word and PDF; articles without a section structure are unchanged.
export function labelSectionsForOutput(markdown: string, sections: CopywritingProjectSection[] | null | undefined): string {
  const list = sections || [];
  if (!list.length || !markdown) return markdown || "";
  const measures = measureSections(markdown, list);
  const nameCount = new Map<string, number>();
  for (const sec of list) nameCount.set(sec.name.toUpperCase(), (nameCount.get(sec.name.toUpperCase()) || 0) + 1);
  const seen = new Map<string, number>();
  const labels = list.map((sec, i) => {
    const name = sec.name.toUpperCase();
    const nth = (seen.get(name) || 0) + 1;
    seen.set(name, nth);
    const m = measures[i];
    const unit = m.unit === "words" ? "WORDS" : "CHARS";
    const counts = m.actual === null ? `${formatChars(m.target)} ${unit}` : `${formatChars(m.actual)}/${formatChars(m.target)} ${unit}`;
    return `${(nameCount.get(name) || 0) > 1 ? `${name} ${nth}` : name} (${counts})`;
  });

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let order = 0;
  while (i < lines.length) {
    const sec = SECTION_LINE_RE.exec(lines[i]);
    if (!sec) {
      out.push(lines[i]);
      i++;
      continue;
    }
    order++;
    const number = sec[1] ? Number(sec[1]) : order;
    const label = labels[number - 1] ?? sec[2].trim().toUpperCase();
    // The section's own lines, up to the next marker.
    let j = i + 1;
    while (j < lines.length && !SECTION_LINE_RE.test(lines[j])) j++;
    const body = lines.slice(i + 1, j);
    const filled = body.filter((l) => l.trim());
    const firstIdx = body.findIndex((l) => l.trim());
    const lastIdx = body.length - 1 - [...body].reverse().findIndex((l) => l.trim());
    const single =
      filled.length === 1 &&
      !PULL_QUOTE_LINE_RE.test(filled[0]) &&
      !IMAGE_LINE_RE.test(filled[0]) &&
      !/^\s*(?:[-*+•]|\d+[.)])\s+/.test(filled[0]) &&
      !/^\s*\|/.test(filled[0]);
    if (single) {
      const text = filled[0].trim().replace(/^#{1,6}\s+/, "");
      out.push(`**${label}:** ${text}`);
      out.push("");
    } else {
      out.push(`**${label}:**`);
      out.push("");
      if (filled.length) out.push(...body.slice(firstIdx, lastIdx + 1));
      out.push("");
    }
    // Two blank lines before the next section.
    if (j < lines.length) {
      out.push(SECTION_BREAK_LINE);
      out.push("");
    }
    i = j;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// What the Copy button puts on the clipboard: section markers removed, pull
// quotes as quoted blockquotes, so the paste reads as a finished article.
export function articleForCopy(markdown: string): string {
  return (markdown || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line) => {
      if (SECTION_LINE_RE.test(line)) return [];
      const pq = PULL_QUOTE_LINE_RE.exec(line);
      return pq ? [`> “${pq[1].trim()}”`] : [line];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// One line that is an image placeholder: [IMAGE 2: …], [PHOTO: …],
// [IMAGE CAPTION: …]. Unnumbered ones are numbered in reading order by
// splitArticleImages().
const IMAGE_LINE_RE = /^\s*\[(?:IMAGE|PHOTO|PICTURE)(?:\s+CAPTION)?\s*#?\s*(\d+)?\s*[:\-–]\s*([\s\S]*?)\]\s*$/i;

export type ArticleSegment =
  | { type: "text"; markdown: string }
  | { type: "image"; slot: number; description: string }
  // "[SECTION n: Name]" — never printed; the draft view shows a length meter.
  | { type: "section"; number: number; name: string }
  // "[PULL QUOTE: …]" — rendered as a highlighted excerpt.
  | { type: "pullquote"; text: string }
  // "[SECTION BREAK]" — two blank lines between sections of the final article.
  | { type: "gap" };

// Splits article markdown into text runs, image slots, section markers and
// pull quotes, so the UI and the exports render each marker line properly
// instead of printing it.
export function splitArticleImages(markdown: string): ArticleSegment[] {
  const segments: ArticleSegment[] = [];
  const used = new Set<number>();
  let buffer: string[] = [];
  const pendingUnnumbered: { index: number; description: string }[] = [];

  const flushText = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (text) segments.push({ type: "text", markdown: text });
  };

  let sectionCount = 0;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (SECTION_BREAK_RE.test(line)) {
      flushText();
      segments.push({ type: "gap" });
      continue;
    }
    const sec = SECTION_LINE_RE.exec(line);
    if (sec) {
      flushText();
      sectionCount++;
      segments.push({ type: "section", number: sec[1] ? Number(sec[1]) : sectionCount, name: sec[2].trim() });
      continue;
    }
    const pq = PULL_QUOTE_LINE_RE.exec(line);
    if (pq) {
      flushText();
      if (pq[1].trim()) segments.push({ type: "pullquote", text: pq[1].trim().replace(/^["“]|["”]$/g, "") });
      continue;
    }
    const m = IMAGE_LINE_RE.exec(line);
    if (!m) {
      buffer.push(line);
      continue;
    }
    flushText();
    const description = m[2].trim();
    const n = m[1] ? Number(m[1]) : NaN;
    if (Number.isFinite(n) && n >= 1 && !used.has(n)) {
      used.add(n);
      segments.push({ type: "image", slot: n, description });
    } else {
      // Unnumbered (or duplicate number): give it the next free slot below.
      pendingUnnumbered.push({ index: segments.length, description });
      segments.push({ type: "image", slot: 0, description });
    }
  }
  flushText();

  let next = 1;
  for (const p of pendingUnnumbered) {
    while (used.has(next)) next++;
    used.add(next);
    (segments[p.index] as { slot: number }).slot = next;
  }
  return segments;
}

// ── Research Ledger: position of a claim in the draft ────────────────────
// Computed in code, never asked of the model (it would guess). A research
// finding is a restatement, not a verbatim copy of the draft's sentence, so
// matching is by significant-word overlap: the paragraph sharing the most of
// the claim's content words (and every figure in it, when it has figures)
// wins. Weak or no overlap → "Not used in draft".
const PLACEMENT_STOPWORDS = new Set([
  "this", "that", "with", "from", "have", "been", "were", "they", "their", "there", "which", "about", "into",
  "also", "such", "than", "then", "them", "these", "those", "some", "more", "most", "over", "under", "only",
  "very", "will", "would", "could", "should", "being", "where", "when", "what", "while", "known", "include",
  "includes", "including", "within", "across", "each", "other", "many", "much", "both",
]);

function placementTokens(text: string): { words: Set<string>; numbers: Set<string> } {
  const words = new Set<string>();
  const numbers = new Set<string>();
  const cleaned = text
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2") // 15,000 → 15000
    .replace(/[*_`#>[\]()]/g, " ");
  for (const raw of cleaned.split(/[^a-z0-9.%]+/)) {
    const t = raw.replace(/^\.+|\.+$/g, "");
    if (!t) continue;
    if (/\d/.test(t)) {
      // "14bn", "14.5m", "30%" and "14" are the same figure written
      // differently ("$14bn" in a finding, "US$14 billion" in the draft).
      const figure = t.replace(/^(\d[\d.]*?)(?:\.0+)?(?:bn|billion|mn|million|m|tn|trillion|k|thousand|%|pc|percent)?$/, "$1");
      numbers.add(figure.replace(/\.0+$/, ""));
      continue;
    }
    if (t.length < 4 || PLACEMENT_STOPWORDS.has(t)) continue;
    words.add(t.replace(/(ies|es|s)$/, "")); // crude plural fold: hills → hill
  }
  return { words, numbers };
}

export function locateClaimInDraft(claim: string, draft: string): string {
  const c = placementTokens(claim);
  if (c.words.size + c.numbers.size === 0) return "Not used in draft";

  // Walk line by line: a heading line opens a new section even when the
  // model put no blank line between it and the paragraph below. A top-level
  // "# Title" is the article title, not a section, so it isn't used as one.
  const paragraphs: { text: string; heading: string | null; inSection: number; overall: number }[] = [];
  let heading: string | null = null;
  let inSection = 0;
  let overall = 0;
  let current: string[] = [];
  const flush = () => {
    const text = current.join(" ").trim();
    current = [];
    if (!text || /^\[[^\]]*\]$/.test(text)) return; // blank / [IMAGE: …] placeholder
    inSection++;
    overall++;
    paragraphs.push({ text, heading, inSection, overall });
  };
  for (const raw of draft.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const sec = SECTION_LINE_RE.exec(line);
    if (sec) {
      flush();
      heading = sec[2].trim();
      inSection = 0;
      continue;
    }
    if (PULL_QUOTE_LINE_RE.test(line)) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      if (h[1].length > 1) {
        heading = h[2].replace(/[*_`]/g, "").trim();
        inSection = 0;
      }
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();

  let best: { score: number; label: string } | null = null;
  for (const para of paragraphs) {
    const p = placementTokens(para.text);
    const wordHits = [...c.words].filter((w) => p.words.has(w)).length;
    const numberHits = [...c.numbers].filter((n) => p.numbers.has(n)).length;
    // A claim built on a figure only counts where that figure appears.
    if (c.numbers.size > 0 && numberHits === 0) continue;
    const hits = wordHits + numberHits * 2;
    const possible = c.words.size + c.numbers.size * 2;
    const score = hits / possible;
    if (wordHits + numberHits < 3 || score < 0.45) continue;

    if (!best || score > best.score) {
      const h = para.heading;
      const label = h
        ? `Section “${h.length > 60 ? `${h.slice(0, 57)}…` : h}”, paragraph ${para.inSection}`
        : `Paragraph ${para.overall}`;
      best = { score, label };
    }
  }
  return best ? best.label : "Not used in draft";
}

// ── Research re-entry: gaps flagged while drafting / revising ────────────
// Appended (code-owned, after the admin prompt) to the drafting and revision
// calls so the gap list always arrives in one parseable shape, whatever the
// admin prompts say. The server strips it from the article and stores it on
// the draft/revision event; nothing is researched automatically — the draft
// screen offers the gaps for the writer to send to Gemini if they choose.
export const FLAGGED_GAPS_CONTRACT = `If writing this needs information that is NOT in the sources or the approved research (a missing figure, date, fact or attribution), do not guess or invent it — write around it, and list each missing item at the very end of your reply, after the article, in exactly this form:

FLAGGED GAPS:
- one specific, researchable question or claim per line

If nothing is missing, do not write the FLAGGED GAPS section at all. Never put anything after it.`;

const FLAGGED_GAPS_RE = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*FLAGGED GAPS\s*(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/im;

// Splits a draft/revision reply into the article and its flagged gaps.
export function splitFlaggedGaps(text: string): { body: string; gaps: string[] } {
  const m = FLAGGED_GAPS_RE.exec(text);
  if (!m) return { body: text.trim(), gaps: [] };
  const body = text.slice(0, m.index).replace(/\n\s*(-{3,}|\*{3,})\s*$/, "").trim();
  const gaps = text
    .slice(m.index + m[0].length)
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.length > 3 && !/^(none|n\/?a|no gaps?)\.?$/i.test(l));
  return { body, gaps: Array.from(new Set(gaps)) };
}
