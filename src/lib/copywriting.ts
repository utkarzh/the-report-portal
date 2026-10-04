import type { CopywritingAnalysis, CopywritingPromptKey } from "@/types";

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
      "Reads every uploaded source plus the TRC guides/examples and publication guide, and extracts style & theme, rules, quotable lines, facts, and information gaps.",
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

// ── Analyze Sources & Styles: marker-delimited section parsing ────────────
// Same technique as parseResearchSections in lib/meeting-prep.ts — long,
// citation-heavy bodies are fragile to escape into JSON, so a unique literal
// marker per section is used instead.
const ANALYSIS_SECTION_KEYS = [
  "STYLE_THEME",
  "RULES",
  "QUOTABLE_LINES",
  "FACTS",
  "GAPS",
] as const;
type AnalysisField =
  | "style_theme"
  | "rules"
  | "quotable_lines"
  | "facts"
  | "gaps";

const ANALYSIS_KEY_TO_FIELD: Record<
  (typeof ANALYSIS_SECTION_KEYS)[number],
  AnalysisField
> = {
  STYLE_THEME: "style_theme",
  RULES: "rules",
  QUOTABLE_LINES: "quotable_lines",
  FACTS: "facts",
  GAPS: "gaps",
};

export function parseAnalysisSections(text: string): CopywritingAnalysis {
  const result: CopywritingAnalysis = {};
  const markerRe =
    /<<<SECTION:(STYLE_THEME|RULES|QUOTABLE_LINES|FACTS|GAPS)>>>/g;
  const matches = [...text.matchAll(markerRe)];
  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1] as (typeof ANALYSIS_SECTION_KEYS)[number];
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const body = text.slice(start, end).trim();
    if (body) result[ANALYSIS_KEY_TO_FIELD[key]] = { text: body };
  }
  // Fallback: no markers found at all — put everything under gaps so nothing
  // silently disappears, and the writer can still see and regenerate it.
  if (Object.keys(result).length === 0 && text.trim()) {
    result.gaps = { text: text.trim() };
  }
  return result;
}

export function analysisSectionsToPrompt(
  a: CopywritingAnalysis | null,
): string {
  if (!a) return "(no analysis available)";
  return `--- STYLE & THEME ---
${a.style_theme?.text || "(missing)"}

--- RULES ---
${a.rules?.text || "(missing)"}

--- QUOTABLE LINES ---
${a.quotable_lines?.text || "(missing)"}

--- VERIFIED FACTS ---
${a.facts?.text || "(missing)"}

--- IDENTIFIED GAPS ---
${a.gaps?.text || "(none)"}`;
}

export const ANALYSIS_SECTION_LABELS: Record<AnalysisField, string> = {
  style_theme: "Style & Theme",
  rules: "Rules",
  quotable_lines: "Quotable Lines",
  facts: "Facts",
  gaps: "Identified Gaps",
};

export const ANALYSIS_SECTION_ORDER: AnalysisField[] = [
  "style_theme",
  "rules",
  "quotable_lines",
  "facts",
  "gaps",
];

// Every section except style_theme carries an individual approve gate (per
// the brief). "All approved" means every OTHER section is approved.
export function analysisAllApproved(a: CopywritingAnalysis | null): boolean {
  if (!a) return false;
  const gated: AnalysisField[] = ["rules", "quotable_lines", "facts", "gaps"];
  return gated.every((f) => a[f] === undefined || a[f]?.approved);
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
  image_count?: number | null;
}): string {
  const n = project.image_count;
  const images =
    n === null || n === undefined
      ? "\nImages: (not specified — decide from the article type, publication and guides whether this article needs photos, and how many)"
      : n === 0
        ? "\nImages: none"
        : `\nImages: ${n} (the article carries exactly ${n} numbered photo placeholder${n === 1 ? "" : "s"}; plan where each one goes)`;
  return `--- ARTICLE REQUEST ---
Editorial objective: ${project.editorial_objective || "(not specified)"}
Section structure: ${project.section_structure || "(not specified — propose a sensible structure)"}
Target length: ${project.target_length ? `${project.target_length} words` : "(not specified)"}
Quotes required: ${project.quotes_required ?? "(not specified)"}${images}`;
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

// One line that is an image placeholder: [IMAGE 2: …], [PHOTO: …],
// [IMAGE CAPTION: …]. Unnumbered ones are numbered in reading order by
// splitArticleImages().
const IMAGE_LINE_RE = /^\s*\[(?:IMAGE|PHOTO|PICTURE)(?:\s+CAPTION)?\s*#?\s*(\d+)?\s*[:\-–]\s*([\s\S]*?)\]\s*$/i;

export type ArticleSegment =
  | { type: "text"; markdown: string }
  | { type: "image"; slot: number; description: string };

// Splits article markdown into text runs and image slots, so the UI can
// render an uploadable slot in place of each placeholder line.
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

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
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
      numbers.add(t.replace(/\.0+$/, ""));
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
