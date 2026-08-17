# Editorial Research Tool — CLAUDE.md

## What we're building

A web platform for **The Report Company** (Phase 01) that lets their editorial team generate AI-powered research and interview questions using Claude. Replaces individual Claude.ai subscriptions with one shared API account.

**End-to-end flow:**
1. Admin invites a user by email → sets their role and monthly token limit
2. User clicks the invite link → signs up → lands on their role-specific dashboard
3. User picks a research category, fills in subject details, clicks Generate → Claude produces the research
4. Admins manage users, prompts, categories, and monitor usage/costs

**Two roles:**
- `admin` — full access: manage users, prompts, categories, view all analytics
- `user` — freelancers/limited staff: generate research up to their monthly token limit

---

## Tech Stack

- **Framework:** Next.js 14 App Router (TypeScript)
- **Database + Auth:** Supabase (Postgres + Supabase Auth)
- **AI:** Anthropic Claude API (`claude-sonnet-4-6`) via `@anthropic-ai/sdk`
- **Styling:** Tailwind CSS
- **Forms:** react-hook-form + zod

---

## Project Structure

```
src/
  app/
    (auth)/           # login, invite accept — no sidebar
    (dashboard)/      # normal user pages — research, history
    (admin)/          # admin-only pages — users, categories, prompts, analytics
    api/              # all API routes (auth checked per-route)
  components/
    admin/            # UserActionsMenu, EditUserForm, CategoryForm, etc.
    research/         # ResearchForm, ResearchOutput, ChatInterface
    layout/           # Header, Sidebar
    ui/               # Button, Input, Modal, Badge, Select, Textarea
  lib/
    auth/session.ts   # requireAdminHeader(), getProfileFromHeaders()
    supabase/         # server.ts, client.ts, admin.ts (service role)
    claude/           # client.ts, tokens.ts
  middleware.ts       # route protection + role enforcement + profile injection
  types/index.ts      # all shared TypeScript types
supabase/
  migrations/
    001_schema.sql    # single source of truth — run this on a fresh DB
```

---

## Architecture Patterns

### Middleware (the access-control layer)
`src/middleware.ts` runs on every non-API, non-static request:
- Unauthenticated → redirects to `/login`
- Deactivated user → signs them out → redirects to `/login?error=account_deactivated`
- Non-admin hitting `/admin/*` → redirects to `/dashboard`
- Injects verified profile into request headers (`x-user-id`, `x-user-role`, `x-user-name`, `x-user-tokens-used`, `x-user-token-limit`)

### Header-based profile reads (zero extra DB calls)
Server components under `/admin` call `requireAdminHeader()` and `getProfileFromHeaders()` — reads middleware-injected headers, no DB round-trip.

### API routes authenticate themselves
API routes are excluded from the middleware matcher. Each API route calls `supabase.auth.getUser()` and checks the role via `supabaseAdmin` (service role). Never trust client-sent headers in API routes.

### Supabase clients — three variants
- `createSupabaseServerClient()` — server components and API routes, uses anon key + cookies
- `createBrowserClient()` — client components
- `supabaseAdmin` — service role, used only in API routes for privileged ops (invite, delete user, etc.)

---

## Database Schema (key relationships)

```
auth.users (Supabase managed)
  └── profiles (1:1, CASCADE on delete)
        ├── invitations.invited_by  (SET NULL on delete)
        ├── invitations.accepted_by (SET NULL on delete)
        ├── research_sessions.user_id (nullable, SET NULL on delete — keeps history)
        ├── categories.created_by   (SET NULL on delete)
        ├── general_prompt.updated_by (SET NULL on delete)
        ├── general_prompt_versions.saved_by (SET NULL on delete)
        └── category_prompt_versions.saved_by (SET NULL on delete)

research_sessions
  └── messages (CASCADE on delete)

categories
  └── category_prompt_versions (CASCADE on delete)
```

**Important:** `research_sessions.user_id` is nullable on purpose. When a user is deleted their research history is kept (US-011 requirement). Analytics must null-check `user_id` and group deleted-user sessions under "Deleted user".

---

## User Stories Reference (from agreement v1.1, 26 May 2026)

| ID | Area | Story |
|---|---|---|
| US-001 | Auth | Login with email + password, routed to role dashboard |
| US-002 | Auth | Sign up via invite link — role + token limit auto-applied |
| US-003 | Auth | Admin → management app, user → editorial tool |
| US-004 | Research | Pick category from dropdown |
| US-005 | Research | Enter subject details → click Generate → Claude output shown |
| US-006 | Research | Normal users blocked (no API call) when token limit reached |
| US-007 | Users | Admin sees table: name, email, role, tokens used/limit, status, joined |
| US-008 | Users | Admin invites by email — system sends invite link |
| US-009 | Users | Admin edits name, role, token limit |
| US-010 | Users | Admin deactivates (instant logout) / reactivates |
| US-011 | Users | Admin permanently deletes — confirmation required, can't delete self, history kept |
| US-012 | Categories | Create category with name, description, prompt |
| US-013 | Categories | Edit category prompt (supports long text, 3+ pages) |
| US-014 | Categories | Delete category (confirmation, existing research kept) |
| US-014a | Categories | Category prompt versioning with full history + rollback |
| US-015 | Prompts | Edit general prompt (applies to all research) |
| US-015a | Prompts | General prompt versioning with full history + rollback |
| US-016 | Analytics | Dashboard: total requests, total cost, cost breakdown by user (current month) |
| US-016a | Analytics | Every generation logged: ID, tokens, user, workflow, errors |
| US-017 | Edge | Expired/used invite link → clear message, no signup possible |
| US-018 | Edge | Generation failure → clear error, no partial save, retry button |
| US-019 | Edge | Normal users can't reach `/admin/*` via direct URL |
| US-020 | Edge | Delete button disabled on admin's own profile row |

---

## Running Locally

```bash
npm install
npm run dev
```

Required `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=                                 # audio transcription (gpt-4o-transcribe) — LEGACY transcription provider
ASSEMBLYAI_API_KEY=                             # audio transcription WITH speaker diarization — DEFAULT provider
NEXT_PUBLIC_TRANSCRIPTION_PROVIDER=assemblyai   # 'assemblyai' (default, diarized) | 'openai' (legacy chunked)

# SMTP — sends normal-user login codes to the editorial inbox (see Login flow below)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=                                      # From address (defaults to SMTP_USER)
```

### Login flow (two paths)
- **Admins** sign in with email + password.
- **Normal users** enter their email and click Sign In. The server mints a one-time
  code and emails it directly to that user's own address. They enter the code to
  finish signing in.

  Single smart form (`/login`): email → `/api/auth/login-init` detects the role and
  returns `password` (admin) or `otp` (user). The OTP is a Supabase code from
  `admin.generateLink({type:'magiclink'})`, emailed via `src/lib/email/smtp.ts`, and
  verified client-side with `verifyOtp`.

### One-device-one-login (all roles)
Every account may be signed in on only one device at a time; the newest login wins.
- On any successful sign-in, the client calls `/api/auth/session-register`, which
  writes a fresh `active_session_id` to the user's `profiles` row and mirrors it into
  an httpOnly `device_session` cookie.
- Middleware compares the cookie against `profiles.active_session_id` on every request.
  A mismatch (the account was signed in elsewhere) clears the cookies and redirects to
  `/login?error=signed_in_elsewhere`.
- Enforcement is skipped while `active_session_id` is NULL, so sessions predating this
  feature stay valid until their next sign-in.

**Database setup:** Run `supabase/migrations/001_schema.sql` in the Supabase SQL editor on a fresh database. For a database that already ran `001` before the one-device feature, also run `supabase/migrations/002_active_session.sql` to add the `active_session_id` column. For a database that predates the transcription module, run `supabase/migrations/005_transcriptions.sql` (idempotent, safe to re-run) — it adds the `transcript_prompt`, `transcript_prompt_versions`, and `transcriptions` tables plus the private `transcription-audio` storage bucket and its RLS. On a database that already ran `005`, also run `supabase/migrations/006_transcript_prompt_verbatim.sql` (idempotent) — it rewrites the default refining prompt to a verbatim, no-speaker-labelling version (gpt-4o-transcribe cannot diarize, so the old prompt made Claude guess speakers); it only touches the singleton if it's still the untouched default. On a database that already ran `005`, also run `supabase/migrations/007_assemblyai_transcription.sql` (idempotent — adds the `transcribe_job_id` column used by the AssemblyAI async-job path) and `supabase/migrations/008_transcript_prompt_preserve_speakers.sql` (idempotent — rewrites the default refining prompt to PRESERVE AssemblyAI's speaker labels; only touches the singleton if it's still one of the known 005/006 defaults) and `supabase/migrations/009_transcription_translation.sql` (idempotent — adds the `translated_transcript` + `translation_language` columns for the single translation slot). On any earlier database, also run `supabase/migrations/010_usage_events.sql` (idempotent — adds the append-only `usage_events` ledger + its RLS, adds the `status` column to `research_sessions`, and best-effort backfills the ledger from existing `research_sessions`/`transcriptions` rows). On any database that predates the topic-outline feature, also run `supabase/migrations/011_topic_outline.sql` (idempotent — adds the `topic_outline` + `topic_outline_filename` columns to `transcriptions` for the optional outline document attached at upload and used as refine context). On any database that predates the Business Cases / Editorial Briefs modules, also run `supabase/migrations/012_document_modules.sql` (idempotent — adds the `can_access_business_cases` + `can_access_editorial_briefs` permission flags to `profiles`/`invitations`, updates `handle_new_user`, and adds the `document_prompt`, `document_prompt_versions`, `document_samples`, and `document_sessions` tables plus the private `document-samples` storage bucket and its RLS). On any database that predates interview company-document uploads, also run `supabase/migrations/013_research_documents.sql` (idempotent — adds the `research_documents` table + its RLS and the private `research-documents` storage bucket for company documents attached to an interview and fed to Claude as research context). On any database that predates the Commercial Meeting Preparation module, also run `supabase/migrations/014_meeting_preparation.sql` (idempotent — adds the `can_access_meeting_preparation` permission flag to `profiles`/`invitations`, updates `handle_new_user`, and adds the `meeting_prep_media_library`, `meeting_prep_planteo_library` (+ versions), `meeting_prep_prompt` (+ versions), and `meeting_prep_sessions` tables plus their RLS — see **Commercial Meeting Preparation module** below). On any database that predates the advertiser-tracker feature, also run `supabase/migrations/015_advertiser_tracker.sql` (idempotent — adds the `meeting_prep_advertiser_tracker` table + its RLS: one per-country row holding the parsed rows of the weekly advertiser tracker spreadsheet, auto-matched to a session's company to fill the Commercial Alert). On any database that predates the advertiser-history "Not aware" option, also run `supabase/migrations/016_advertiser_history_not_aware.sql` (idempotent — widens the `advertiser_history_status` CHECK constraint to allow `'not_aware'` alongside `'yes'`/`'no'`, since the intake form field is now optional and defaults to it). These are already merged into `001` for fresh installs.

### Transcription module
- **Two providers, chosen by `NEXT_PUBLIC_TRANSCRIPTION_PROVIDER`:**
  - **`assemblyai` (default, does speaker diarization):** compress the whole file in-browser to a compact 16kHz mono MP3 (`transcodeToMp3`, [src/lib/ffmpeg-client.ts](src/lib/ffmpeg-client.ts)) → upload just that small MP3 → submit ONE async transcript job with `speaker_labels: true` ([src/lib/assemblyai/client.ts](src/lib/assemblyai/client.ts)) → client polls to completion → speaker-labelled raw transcript (`Speaker A: …`). Compressing before upload keeps big source files (e.g. a 157 MB WAV → ~11 MB MP3) off Supabase Storage — cheaper and under the storage file-size limit — and the one MP3 serves both the job and in-app playback. No chunking/splitting: diarization needs the whole recording so speaker identities stay consistent. AssemblyAI fetches the audio from a short-lived Supabase signed URL, so it never hits our request body. Job id is stored in `transcribe_job_id` (migration 007) for polling/resume. Route: [transcribe-assemblyai/route.ts](src/app/api/transcriptions/[id]/transcribe-assemblyai/route.ts) — POST submits, GET polls.
  - **`openai` (legacy, no diarization):** the chunked/streaming path described below. Kept as a fallback until AssemblyAI is fully proven, then removable.
- **Translate flow (optional, independent of refine):** the raw transcript can be translated into ONE of `English | German | Spanish | Italian | Russian` ([TRANSLATION_LANGUAGES](src/lib/transcriptions.ts)). `POST /api/transcriptions/[id]/translate` streams Claude (`claude-sonnet-4-6`; see cost note below) with a fixed translation system prompt that preserves speaker labels, and stores the result in the single translation slot (`translated_transcript` + `translation_language`, migration 009) — re-translating overwrites it. Token-gated and billed exactly like refine. Raw, translated, and refined are three independent branches off the raw transcript; all are saved and each has its own `.docx` download (`?variant=raw|refined|translated`). Both translate and refine now ACCUMULATE onto the transcript's `tokens_*`/`cost_usd` totals (and each increments the user's global budget).
- **Refine flow (works for both providers):** saved refining prompt (singleton `transcript_prompt`) + the chosen source transcript → Claude (`claude-sonnet-4-6`, streamed) → refined transcript. `POST /refine` takes `{ source: 'raw' | 'translated' }` (defaults to `raw`); the UI refines the raw transcript directly, but when a translation also exists it first pops a picker asking which one to clean up. The result overwrites the single `refined_transcript` slot regardless of source. With AssemblyAI the raw transcript carries real `Speaker A:` / `Speaker B:` labels, so the default refining prompt (migration 008) instructs Claude to PRESERVE those labels verbatim rather than strip or guess them. (Migrations 005/006 wrote the old no-diarization prompts; 008 upgrades any DB that still has either default and 001 ships the new text for fresh installs.)
- **OpenAI flow:** upload audio → **in-browser transcode + split** (ffmpeg.wasm) → per-chunk streaming transcription (OpenAI `gpt-4o-transcribe`, SSE) → raw transcript → optional AI refine (Claude, using the admin-managed **refining prompt**, streamed) → refined transcript. Original audio, chunk audio, raw transcript, and refined transcript are all persisted (`transcriptions` row + private storage bucket).
- **Why chunking (serverless):** the app runs on serverless (Vercel), which has a hard request-time limit, and OpenAI caps transcription at 25 MB / ~25 min per request. So the browser uses **ffmpeg.wasm** ([src/lib/ffmpeg-client.ts](src/lib/ffmpeg-client.ts)) to downsample to 16kHz mono MP3 and split into 10-min chunks. Each chunk is transcribed in its **own short serverless request**, orchestrated sequentially by the client ([TranscriptionWorkspace](src/components/transcriptions/TranscriptionWorkspace.tsx)). This removes both the size and the timeout ceilings, so hour-long recordings work. ffmpeg core is self-hosted under `/public/ffmpeg` (copied on `postinstall` by [scripts/copy-ffmpeg-core.mjs](scripts/copy-ffmpeg-core.mjs); gitignored).
- **Upload path:** the browser uploads the original file (for playback) **and** each chunk *directly* to the private `transcription-audio` bucket (RLS-scoped to the user's own `<uid>/` folder), then `POST /api/transcriptions` records the row with `chunk_paths[]`. Keeps large audio off the API request body. `transcribe/route.ts` transcribes one `chunkIndex` per call and joins per-chunk text into `raw_transcript` when the last chunk lands (resumable — the workspace restarts from the first pending chunk).
- **Refining prompt** mirrors the interview general prompt exactly: singleton `transcript_prompt` + `transcript_prompt_versions`, versioned with snapshot-on-save and rollback, managed at `/admin/transcript-prompt` via `/api/transcript-prompt`. The shared `PromptVersionHistory` component handles all three prompt types (`general` | `category` | `transcript`).
- **Cost/limits:** the Claude refine step counts against the user's token limit (gated pre-flight like research). OpenAI transcription is billed separately and is not counted in token usage. **Model choice:** every user-facing workflow — research, question generation, refine, translate, business cases, editorial briefs — runs on `claude-sonnet-4-6` (`$3/$15` per 1M in/out). Refine and translate briefly ran on `claude-haiku-4-5` to cut cost (they rewrite the whole transcript, so output dominates), but were **deliberately moved back to Sonnet for output quality** in commit `67cab80` — don't "optimise" them back to Haiku without re-checking transcript quality first. The only Haiku call left is the sub-cent input-screening gate (see **Input screening** below). Per-model pricing lives in [tokens.ts](src/lib/claude/tokens.ts) (`SONNET_PRICING` / `HAIKU_PRICING`); `calculateCost(usage, pricing)` takes the profile so the ledger records the real cost — pass the pricing that matches the model you called. Refine and translate each also append a `usage_events` ledger row (see **Usage ledger & analytics** below), so their Claude spend shows in analytics; AssemblyAI transcription is free and untracked.

### Usage ledger & analytics
- **`usage_events` is the append-only source of truth for cost analytics** (migration 010, satisfies US-016a). Every Claude call appends ONE immutable row via `logUsageEvent()` ([src/lib/claude/usage.ts](src/lib/claude/usage.ts)) with a `workflow` of `research` | `research_questions` | `transcript_refine` | `transcript_translate` | `business_case` | `editorial_brief` | `input_validation`, plus tokens, cost, web_searches, model, `source_id` (no FK — survives item deletion), and `status`/`error`. `usage_events.workflow` is plain TEXT with no CHECK constraint, so adding a workflow needs no migration — but DO add it to `UsageWorkflow` in [types/index.ts](src/types/index.ts) and to both `WORKFLOW_LABELS` and `WORKFLOW_ORDER` in the analytics page, or it won't render.
- **Analytics reads `cost_usd` from the ledger, never re-derives it.** Every headline, per-workflow, and per-user figure is a sum of the per-row `cost_usd` written at call time with that call's own model pricing, so a mixed-model ledger totals correctly. The one exception is the display-only input/output/search split ([analytics/page.tsx](src/app/(admin)/admin/analytics/page.tsx)), which prices output at the Sonnet rate and derives input as the residual — the total is always exact, only the split can skew, and only for non-Sonnet rows.
- **Capturing usage from a stream:** a streamed call's token counts come from the **final** message. Routes that read `claudeStream.finalMessage().usage` get them exactly. The document route can't — it may abort mid-stream at the soft deadline — so it accumulates from stream events, and `output_tokens` arrives **only** on `message_delta`, at the end. A pass cut short therefore sees no output count at all; it recovers one via `messages.countTokens()` on the text it received. **If you add another abortable streaming route, do the same** — otherwise cut-short passes silently bill as if the model wrote nothing, which is most of the real cost.
- **Why a ledger:** usage used to be stamped onto the mutable `research_sessions`/`transcriptions` rows. Regenerating research OVERWROTE those totals (analytics lost every regeneration) and transcription spend was never in analytics at all. The per-item rows still carry their own totals for the item UI (`cost_usd` accumulates there), but `/admin/analytics` reads the ledger — so it counts every regeneration and includes transcription cost. The user's global budget (`profiles.tokens_used`) is charged cumulatively and independently, exactly as before.
- **Analytics** ([src/app/(admin)/admin/analytics/page.tsx](src/app/(admin)/admin/analytics/page.tsx)) supports date ranges (this month / last month / last 30 days / all time via `?range=`), a cost-over-time trend, a per-workflow breakdown, and a per-user table — all from the ledger. Charts are deliberately monochrome to match the app's design language.

### Document modules (Business Cases, Editorial Briefs)
Both run ONE generic engine keyed by `doc_type`; everything that differs lives in [documents.ts](src/lib/documents.ts) (`DOC_TYPES`) — labels, slug, permission flag, `maxTokens`, `maxWebSearches`, `tokenReserve`, `lengthGuidance`. Add a third document type there, not by forking the route.

- **Prompt assembly** ([generate/route.ts](src/app/api/documents/[id]/generate/route.ts)): system = `SEARCH_POLICY` (dated, recency rules) + the admin prompt snapshot + `OUTPUT_CONTRACT`. The contract is placed **last on purpose** so it overrides the admin prompt — several admin prompts describe a Claude.ai-style "write it in chat, then build a Word doc" flow, which makes the model narrate. Note `lengthGuidance` in the task block can contradict the page count in the DB prompt; the code wins.
- **Segmented generation:** one document is written across several passes. A pass ends when it hits the route's soft deadline OR Claude's own `max_tokens` — neither means the document is finished. Only the `<<<DOCUMENT_COMPLETE>>>` marker (or the model ending its turn) means done. The client **auto-continues**: [DocumentOutput](src/components/documents/DocumentOutput.tsx)'s `runToCompletion()` chains passes until done, capped at `AUTO_CONTINUE_MAX` rounds, with a Stop control; reaching the cap or stopping falls back to the manual Continue button. Reopening a mid-run session does NOT auto-resume — the user decides when to spend more.
- **The soft deadline must be a timer, not an in-loop check.** The loop only advances when a stream event arrives, and the SDK's iterator yields no keepalive (`RawMessageStreamEvent` has no `ping`), so during a quiet stretch — a server-side web-search round-trip — an in-loop deadline cannot fire and the function sails past the platform's hard cap, skipping the persist/billing/logging that follows the loop. It's a `setTimeout` that calls `claudeStream.abort()`, with the loop wrapped so only our own abort is swallowed.
- **Vercel duration:** with fluid compute (default on new projects) Hobby is **300s default and maximum** — the older 60s Hobby cap no longer applies. `maxDuration = 300` with a 15s margin gives a 285s soft deadline; override via `DOC_GEN_SOFT_DEADLINE_MS` only if the real cap differs. An early version chunked at a fixed `ROUND_MAX_TOKENS = 2500` to fit the assumed 60s window; that's gone — passes now use the type's full `maxTokens`, so a brief needs ~2-4 rounds, not a dozen.
- **Incremental persistence:** the route saves `output` every ~2.5s while streaming, so even a hard kill loses at most a couple of seconds, and the client's `recoverSaved()` picks up the saved text on a dropped stream.
- **Input screening** ([validate-inputs.ts](src/lib/claude/validate-inputs.ts)): `POST /api/documents` screens the submission **before** creating the session, so placeholder or off-topic input (a one-letter country, "write me a python script") can't spend a full document's budget. A free local check first, then a `claude-haiku-4-5` JSON verdict. Deliberately **permissive** (approve when unsure) and **fails open** on API error — it's a misuse guard, not a security boundary. Rejections return **422** with a user-facing reason. Only the document modules are gated; the interview/research module is not.

### Commercial Meeting Preparation module
Prepares TRC sales reps for meetings with company CEOs / government officials, per the client-authored brief (`docs/TRC_Commercial_Meeting_Prep_Brief_v1_1.pdf`, translated to user stories in `docs/TRC_Commercial_Meeting_Prep_User_Stories_v1.pdf`, US-021→US-032). Gated by `can_access_meeting_preparation` (profiles/invitations), wired through [access.ts](src/lib/access.ts)/middleware/Sidebar exactly like the other modules — **not** part of the `DOC_TYPES` engine, since its workflow is multi-stage/stateful rather than one-shot.

- **Schema** (migration `014_meeting_preparation.sql`): `meeting_prep_sessions` is the workflow's state machine — `stage` walks `input → researching → awaiting_review → points_generating → points_pending → planteo_generating → planteo_pending → final_generating → complete` (or `failed` at any point). `research_sections` (JSONB: `interviewee`/`organisation`/`motivation_profiles`/`quotes_news`) and `presentation_points` (JSONB string array) hold the two structured, editable-by-piece outputs; `planteo_output`/`final_output` are plain text. Each of the 4 sequential prompts (`meeting_prep_prompt`, keyed by `prompt_key`) and the 2 fixed Planteo Library variants (`meeting_prep_planteo_library`, keyed by `variant`) is versioned (`*_versions` tables) via the shared [PromptVersionHistory](src/components/admin/PromptVersionHistory.tsx) component (`type: 'meeting_prep_prompt' | 'meeting_prep_planteo'`). `meeting_prep_media_library` (one row per TRC publication) is plain CRUD, no versioning — a publication with no row here halts Step 1 with zero API cost (US-022), per [`src/app/api/meeting-prep/route.ts`](src/app/api/meeting-prep/route.ts).
- **Four sequential Claude calls, one per stage**, each its own route under `src/app/api/meeting-prep/[id]/` (`research`, `points`, `planteo`, `final-document`), each independently token-gated right before its own call (`MEETING_PREP_*_RESERVE` in [tokens.ts](src/lib/claude/tokens.ts)) and each logging its own `usage_events` workflow (`meeting_prep_research` | `meeting_prep_points` | `meeting_prep_planteo` | `meeting_prep_final_document`). A stage only starts once the prior stage's output is approved — enforced by checking `session.stage` at the top of each route, not just in the UI.
- **Research output uses marker-delimited sections, not JSON.** The research prompt is instructed to emit `<<<SECTION:INTERVIEWEE>>>` etc. as literal markers; [`parseResearchSections`](src/lib/meeting-prep.ts) splits on them. This was chosen over asking the model for a JSON object because the section bodies are long, citation-heavy markdown — safely JSON-escaping that from a streaming model is fragile, while splitting on a unique literal marker isn't. The internal narrative validation step (US-026, invisible to the user) runs as a second Sonnet call with a `json_schema` verdict (mirrors [validate-inputs.ts](src/lib/claude/validate-inputs.ts)'s pattern) and is capped at **one** reframe retry so a stubborn miss can't loop cost indefinitely.
- **Per-section regeneration is new plumbing, not reused from elsewhere.** Every other AI-output surface in this app (research, business cases, editorial briefs) streams one flat text blob where "regenerate" means discard-and-restream the whole thing — there was a `messages`/chat table for finer-grained refinement once, but it was deliberately dropped (see `supabase/teardown.sql`). `POST /api/meeting-prep/[id]/research/regenerate` takes `{section, feedback}`, sends only that section's slice of context (plus the other three accepted sections, shown but marked "do not contradict") back to Claude, and overwrites just that one JSONB key — every other section and any user edits already saved are untouched. The presentation points ("regenerate one of three" / "reframe all three") use the same targeted-vs-full pattern; the planteo, being one continuous spoken script, only supports full regeneration with feedback.
- **Direct manual edits** (no AI call) for research sections, presentation points, and the planteo go through a single `PATCH /api/meeting-prep/[id]` with an allowlist of editable fields, rather than a route per field.
- **Final document QC** (US-031): the closing instructions inside the `final_document` prompt assert the brief's full checklist (every claim sourced, no overt motivation labels, correct planteo variant, ≤4 pages, etc.) — that's the real check. [`final-document/route.ts`](src/app/api/meeting-prep/[id]/final-document/route.ts) adds one cheap heuristic backstop on top: a regex check that all six fixed section headings are present, triggering exactly one corrective re-prompt if any are missing.
- **`.docx` export** reuses the Business Case/Editorial Brief template's markdown→docx renderer (`renderTokens` and the shared style constants, exported from [docx-template.ts](src/lib/docx-template.ts)) but needs its own cover page (interviewee/title/company/publication instead of country/media-partner), so it has a dedicated sibling builder in [meeting-prep-docx.ts](src/lib/meeting-prep-docx.ts) rather than forcing this module into `DocTypeConfig`.
- **Known gap:** Appendix A (the actual approved planteo scripts for both variants) had not been delivered by the TRC commercial team as of this build — the Planteo Library ships with the mechanism fully wired (admin-editable, versioned) but empty `template_text` for both variants until that content is supplied.

### Background generation (research)
- `research_sessions.status` (`pending` | `generating` | `complete` | `failed`, migration 010) tracks a run's lifecycle. `/api/generate` sets `generating` on start and `complete`/`failed` at the end (persist-first, so a client disconnect never loses finished work).
- A user who **returns to a session mid-run** (no `?generating=true`, but `status === 'generating'`) can't re-attach to the original SSE stream, so [ResearchOutput](src/components/research/ResearchOutput.tsx) polls `GET /api/sessions/[sessionId]` every 3s and loads the result once `status` settles, showing a "generating in the background" state meanwhile. (True guaranteed background completion on serverless is not assured; this is the realistic reconnect.)

---

## Key Decisions & Constraints

- **Modular workflows:** Research generation is a self-contained flow. Future AI workflows (e.g. question generation only, summarisation) should be added as separate modules without touching existing code.
- **Provider-agnostic AI layer:** The Claude client lives in `src/lib/claude/`. If the provider changes, only that layer changes.
- **Streaming output panes must use `useStickToBottom`** ([src/lib/use-stick-to-bottom.ts](src/lib/use-stick-to-bottom.ts)) — spread its `ref`/`onScroll`/`onWheel` onto the element that actually has `overflow-y-auto`. Never auto-scroll unconditionally (`scrollIntoView` on every token): it makes it impossible to read earlier text mid-stream. The hook needs BOTH signals — `onScroll` alone loses the race against a fast stream, because a programmatic pin can re-anchor the view in the gap between the user's gesture and the browser reporting the new `scrollTop`.
- **Token limit check happens before API call** — never after. A failed check must not incur any API cost.
- **Prompt versioning:** Every save to `general_prompt` or a category's `prompt_text` must snapshot the old version to the corresponding `_versions` table before writing.
- **Invite links are single-use and expire after 7 days.** The `handle_new_user` DB trigger marks the invitation `accepted` atomically on signup.
- **Admin cannot delete or change the role of their own account** — enforced in UI and should be enforced in API too.
