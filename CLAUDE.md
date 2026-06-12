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

# SMTP — sends normal-user login codes to the editorial inbox (see Login flow below)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=                                      # From address (defaults to SMTP_USER)
OTP_DELIVERY_EMAIL=utkarsh.parihar.435@gmail.com     # inbox that receives login codes
```

### Login flow (two paths)
- **Admins** sign in with email + password.
- **Normal users** enter their email and click Sign In. The server mints a one-time
  code and emails it to `OTP_DELIVERY_EMAIL` (editorial@the-report.com) — NOT to the
  user. A gatekeeper relays the code to the user, who enters it to finish signing in.
  This is a manual approval gate: users cannot self-serve login.

  Single smart form (`/login`): email → `/api/auth/login-init` detects the role and
  returns `password` (admin) or `otp` (user). The OTP is a Supabase code from
  `admin.generateLink({type:'magiclink'})`, emailed via `src/lib/email/smtp.ts`, and
  verified client-side with `verifyOtp`.

**Database setup:** Run `supabase/migrations/001_schema.sql` in the Supabase SQL editor on a fresh database. That's the single migration file — no migration runner needed.

---

## Key Decisions & Constraints

- **Modular workflows:** Research generation is a self-contained flow. Future AI workflows (e.g. question generation only, summarisation) should be added as separate modules without touching existing code.
- **Provider-agnostic AI layer:** The Claude client lives in `src/lib/claude/`. If the provider changes, only that layer changes.
- **Token limit check happens before API call** — never after. A failed check must not incur any API cost.
- **Prompt versioning:** Every save to `general_prompt` or a category's `prompt_text` must snapshot the old version to the corresponding `_versions` table before writing.
- **Invite links are single-use and expire after 7 days.** The `handle_new_user` DB trigger marks the invitation `accepted` atomically on signup.
- **Admin cannot delete or change the role of their own account** — enforced in UI and should be enforced in API too.
