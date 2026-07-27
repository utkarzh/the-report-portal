# Cash Box Platform — Build Requirements & User Stories

**Prepared for:** The Report Company · Internal Platform · Module 02
**Status:** Requirements draft v1
**Delivery:** Phased — MVP first

A weekly field-expense reconciliation module (“caja”) built inside the existing editorial
platform — one login, one user directory, receipts as the source of truth, and every
expense traceable from cash advance to approved balance.

---

## Executive summary

Today the caja process is manual: field directors photograph receipts into SharePoint,
retype them into a locked Excel, and three people in Madrid cross-check every line by hand
before money is released. We are replacing that with a module inside your current tool.
Finance sets up a project and funds a director; the field team uploads receipts from their
phone; AI reads each receipt and drafts the expense; a rules engine flags anything unusual
by severity; Finance verifies or rejects with a reason; verified expenses draw down the
balance automatically. Every step is logged and reviewable in one place, with zero email.

> **It lives in the same application and the same repository.** No second product, no
> separate login. Finance, editorial, and future modules (logistics, commercial) share one
> identity system, one user directory, and one analytics spine. This document lists
> everything to build, split into an **MVP** (the core money loop) and a **Phase 2** (the
> formal weekly caja, audit report, and Excel generation).

---

## 1. Roles & who can do what

Administrative authority becomes **domain-scoped**. There is no longer a single all-powerful
admin: the person who runs Finance cannot see or touch editorial administration, and vice
versa. This is enforced on the server, not just hidden in the interface.

| Role | Scope | Responsibility |
|---|---|---|
| **Super Admin** | Platform | Provisions user accounts and grants each person access to specific modules (editorial, finance, …). Does not run any module day-to-day. The only role that creates logins. |
| **Finance Admin** | Finance · Madrid | Creates projects, assigns team members, sends funds, reviews every expense, flags/verifies/rejects, approves cajas. Cannot reach editorial administration. |
| **Field Director** | Field · Project head | Financially accountable for a project. Receives the cash advance, uploads receipts, logs expenses, confirms cash on hand, submits the weekly caja. |
| **Sales Representative** | Field · Support | Helps a project’s day-to-day data entry (upload receipts, log expenses) but has no financial ownership: cannot receive funds, confirm balances, or submit. |

Editorial **Admin** and editorial **User** (research, interview, transcription) continue
exactly as today, unaffected by any of this.

---

## 2. The six expense categories & mandatory receipt fields

The six categories are fixed across every project — never renamed, merged, or added to.
Every expense is assigned to exactly one:

`Transport / Gas / Tolls` · `Accommodation` · `Communications` · `Other Services` · `Printing / Office Material` · `Bank Charges`

Every receipt must yield these fields before an expense can be logged. AI extracts them; the
field user confirms or corrects:

| Field | Requirement |
|---|---|
| **Amount** | Clearly visible, with currency symbol or code (all currencies present on the receipt) |
| **Concept** | What was purchased or the service received |
| **Date** | Should fall within the reporting week (out-of-period is flagged, not rejected) |
| **Reference** | Receipt / transaction number or vendor signature — used to catch duplicates |
| **Vendor / location** | Where the expense occurred, where applicable |

> **Currency:** a director is always paid in one settlement currency — **USD or EUR**, chosen
> when the project starts. Expenses are recorded in local currency and converted using the
> director’s own chosen exchange rate; the system preserves that rate and never overrides it.
> When a receipt already shows both local and settlement amounts, we use the receipt’s numbers
> directly.

---

## 3. User stories

Grouped into epics A–J. Each story carries an ID, a phase tag, and acceptance criteria.
**[MVP]** is the core loop that delivers value on day one; **[Phase 2]** completes the formal
caja and compliance layer.

### Epic A — Platform access & roles
*The foundation — changes to the existing auth system.*

**A-01 · [MVP]**
As a super admin, I want to invite a person by email and grant them access to specific
modules (editorial, transcription, finance) so that one account works across the whole
platform with one login.
- Invite reuses the existing single-use, 7-day invite-link flow.
- Per module I can grant either **User** or **Admin** level.
- Access is stored in a general grants model so new modules need no rebuild.

**A-02 · [MVP]**
As the organisation, I want finance-admin and editorial-admin to be mutually exclusive so
that no one holds administrative power across both domains.
- A user cannot be granted Admin on both editorial and finance.
- Enforced server-side (API + route guards), not only in the interface.
- A finance admin who navigates directly to an editorial-admin URL is redirected away, and vice versa.

**A-03 · [MVP]**
As any user, I want to log in once and land on the module I have access to so that the
platform feels like one tool.
- Sidebar shows only the modules the user is granted.
- Finance admins sign in with a password; field users use the existing email-code flow.
- One-device-one-login and deactivation rules apply unchanged.

**A-04 · [MVP]**
As the team, I want existing accounts to keep working so that the editorial tool is never
disrupted by this change.
- Current admins migrate to super admin; current module flags migrate into the grants model.
- No editorial user experiences any change to research, interview, or transcription.

### Epic B — Projects & team setup
*Finance admin — the container for everything.*

**B-01 · [MVP]**
As a finance admin, I want to create a project so that a field team has a place to record its
expenses.
- Fields: project name (e.g. “India — The Guardian 2026”), **country** (dropdown, exactly one), **settlement currency** (USD or EUR), **exchange rate** (editable), associated media/publication.
- One country per project is enforced (tax requirement).
- Each project has its own independent balance.

**B-02 · [MVP]**
As a finance admin, I want to assign one Director and one or more Sales Reps to a project so
that the right people can work its cajas.
- Members are chosen from finance-enabled accounts (created first by the super admin).
- Exactly one Director per project; the Director is the financially accountable person.
- Members can be added or removed later.

**B-03 · [MVP]**
As a finance admin, I want one Director to run several projects at once so that simultaneous
engagements (e.g. India and Pakistan) stay fully separate.
- Each project keeps its own balance, currency, and team.
- A user sees all projects they belong to after login.

### Epic C — Funding & balance
*Money in — the running ledger.*

**C-01 · [MVP]**
As a finance admin, I want to record funds sent to a Director with photographic evidence so
that the opening balance is documented, not self-reported.
- A funding entry captures amount, date, and an uploaded proof image.
- Only a finance admin can record or adjust funding — never the Director.
- The first funding sets the opening balance; later top-ups add to it.

**C-02 · [MVP]**
As anyone on a project, I want a running balance so that everyone sees how much is left at a
glance.
- Balance = total funds received − total **verified** expenses.
- The ledger lists every funding event and every verified expense in order.
- Pending (unverified) expenses are shown separately and do not yet reduce the balance.

**C-03 · [Phase 2]**
As a finance admin, I want a week’s closing balance to seed the next week automatically so
that no one re-enters carry-forward amounts.
- Carry-forward is always verified by Finance before the next week opens.

### Epic D — Receipt capture & expense logging
*Field team — the phone-first core.*

**D-01 · [MVP]**
As a field user, I want to see my active project(s) and their spend so that I know where I
stand before uploading.
- Landing shows each project’s remaining balance and spend by category.
- Works well on a phone.

**D-02 · [MVP]**
As a field user, I want to upload a receipt photo, screenshot, or PDF so that I can log an
expense the moment it happens.
- Accepts photos (incl. low-quality / handwritten annotations), payment-app screenshots, and PDF invoices.
- Upload happens continuously through the week — no bulk dump required.

**D-03 · [MVP]**
As a field user, I want AI to read the receipt and pre-fill the expense so that I don’t type
it by hand.
- AI extracts amount + currency, concept, date, reference, vendor, and suggests one of the 6 categories.
- Handles receipts in local languages and multiple currencies.
- Low-confidence fields are highlighted for me to correct.
- If a required field can’t be read, the system asks rather than inventing a value.

**D-04 · [MVP]**
As a field user, I want to confirm and log the expense once fields are complete so that it
enters the review queue.
- Logging is allowed only when all mandatory fields are present.
- A logged expense starts as **Pending review**.

**D-05 · [MVP]**
As a field user, I want a ride-app screenshot with several trips to become several expenses so
that each trip is counted correctly.
- The system detects multiple trips in one image and creates one line per trip.

**D-06 · [MVP]**
As a field user, I want to see the status and any rejection reason for each expense so that I
can fix and re-upload.
- Each expense shows Pending / Verified / Rejected, with the reviewer’s reason if rejected.
- I can correct the data or replace the image and resubmit.

### Epic E — Review, flags & verification
*Finance admin — replacing the manual cross-check.*

**E-01 · [MVP]**
As a finance admin, I want a review queue of logged expenses so that I can check them without
opening SharePoint folders.
- Queue spans all my projects, filterable by project, status, and category.
- Each item shows the receipt image beside its extracted data.

**E-02 · [MVP]**
As a finance admin, I want the system to flag suspicious expenses by severity so that I focus
on what matters.
- Flags include: **duplicate** (same amount + date + supplier), **weekend** date (per-country weekend rules), **over-budget** daily spend (e.g. accommodation 70/110 per night), **missing/illegible** fields, **suspicious/personal** purchase, **currency** anomaly, and **prior-approval required** (Other Services / PR).
- Flags highlight for human review — the system never auto-rejects.
- Deterministic checks run in code; only judgement calls use AI.

**E-03 · [MVP]**
As a finance admin, I want to verify an expense so that it counts and draws down the balance.
- Verifying deducts the settlement amount from the project balance automatically.
- The action is logged with who and when.

**E-04 · [MVP]**
As a finance admin, I want to reject an expense with a written reason so that the field user
knows exactly what to fix.
- The reason is visible to the field user and returns the item for correction.
- I can also add my own manual flag/annotation to an expense.

### Epic F — Weekly caja, audit report & Excel
*Phase 2 — the formal compliance layer.*

**F-01 · [Phase 2]**
As a field director, I want expenses grouped into a weekly caja with a submit step so that
Finance reviews a defined week.
- A caja has a week number and date range and moves through a state machine: Draft → Ready → Submitted → Under review → (Incidents ↔ Resubmitted) → Approved → Closed.
- Every transition is logged as an audit-trail event (who, when, from, to, comment).
- Once submitted, the week is read-only except inside scoped incident fixes.

**F-02 · [Phase 2]**
As a field director, I want to confirm physical cash on hand before submitting so that the
closing balance is trustworthy.
- Submit is blocked until cash-count confirmation and all flags are resolved or justified — enforced server-side.

**F-03 · [Phase 2]**
As a finance admin, I want an automated audit report with a clear verdict so that my final
check is fast and consistent.
- Covers completeness, amount/date/category accuracy, duplicates, weekend spend, daily budgets, and cash reconciliation.
- Ends in one verdict: **PASS · PASS WITH OBSERVATIONS · REVIEW REQUIRED · HIGH RISK**.

**F-04 · [Phase 2]**
As Finance, I want the official Excel produced without touching its structure so that
historical processes and formulas stay intact.
- Generated Excel keeps the template’s structure, SUM formulas, and currency conversion formulas untouched.
- Final Excel and audit report are immutable and versioned after approval.

### Epic G — Incidents & communication
*Phase 2 — replaces the Basecamp trail.*

**G-01 · [Phase 2]**
As a finance admin, I want to open an incident against a specific receipt or line so that
corrections are tracked, not lost in chat.
- An incident has a description, required action, and due date, with a threaded conversation.
- The director replies, re-uploads, or edits the specific line in the same thread.
- Resolving all open incidents moves the caja back to Resubmitted automatically.

**G-02 · [Phase 2]**
As a participant, I want to be notified of what needs my attention so that nothing stalls.
- Director is notified on new incidents and rejections; Finance is notified on submission and resubmission.

### Epic H — Analytics & cross-project dashboard
*Finance oversight.*

**H-01 · [MVP]**
As a finance admin, I want spend analytics by category, project, and period so that I
understand where money goes.
- AI usage cost is logged to the shared platform usage ledger, tagged as finance workflows.

**H-02 · [Phase 2]**
As a finance admin, I want a cross-project balance dashboard so that I can see every project’s
balance, outstanding cajas, and pending transfers at once.
- One view across all active projects, no folder-by-folder checking.

### Epic J — Inter-project transfers
*Phase 2 — money between a Director’s own projects.*

**J-01 · [Phase 2]**
As a finance admin, I want to move funds between a Director’s projects so that e.g. an India
fund can top up a Pakistan fund while staying fully separate.
- The transfer is reclassified into the receiving country’s project and fully logged (amount, from, to, who, when, why).
- Both projects remain financially independent.

---

## 4. Non-negotiable compliance rules

These are operational and compliance constraints from Finance, not preferences. The system is
built around them.

1. **Receipts are the source of truth** — the Excel is never assumed correct. Every discrepancy is flagged, never silently resolved in the Excel’s favour.
2. **The six categories are fixed** — never renamed, merged, or added to.
3. **The Excel template structure and formulas are never modified.** Totals use SUM formulas; currency uses rate formulas — breaking them invalidates the caja.
4. **The director’s chosen exchange rate is preserved**, never overridden or normalised.
5. **Inter-week balances are verified by Finance** — never self-reported by the director.
6. **No funds are released without a validated caja** — a hard control, enforced server-side.
7. **Illegible or incomplete receipts are flagged, not auto-rejected** — human judgement decides borderline cases.
8. **Every flag and incident creates a traceable record** — the platform is the full audit trail.
9. **Other Services (PR, interpreters, couriers) are flagged for prior approval** before reimbursement.
10. **A ride-app screenshot counts as one line per trip shown.**

---

## 5. What changes in the existing system

For transparency, the concrete engineering work behind the stories above. All of it is
additive — the editorial tool is untouched at runtime.

| Area | Change |
|---|---|
| **Access model** | Replace hardcoded module flags and the single admin role with a general grants model (per-user, per-module, user/admin). Enables the admin-domain split and future modules with no rebuild. |
| **Auth & routing** | Add a finance route area for the field app (phone-first) and a finance-admin console. Route/API guards enforce domain separation. |
| **Database** | New tables for projects, members, funding, receipts, expenses, flags, and (Phase 2) cajas, incidents, status events, file versions, transfers. A private, access-scoped storage bucket for receipt and proof images. |
| **AI layer** | Vision extraction (receipt → structured fields) plus judgement-only flagging, through the existing Claude integration. Deterministic checks (duplicates, weekends, budgets, reconciliation) run in code. All AI cost logged to the shared usage ledger. |
| **Interface** | Finance field app, review queue, flag cards, balance ledger, analytics, and (Phase 2) the caja state machine, audit report, and Excel generation. Navigation renders from the grants model. |

---

## 6. Delivery roadmap

### MVP — the core money loop
- **Foundation:** access-model refactor + role split (Epic A).
- **Setup:** projects, teams, funding & balance (Epics B, C).
- **Field:** receipt upload + AI extraction + expense logging (Epic D).
- **Review:** queue, flags, verify/reject, balance draw-down (Epic E).
- **Insight:** spend analytics (Epic H-01).

### Phase 2 — formal caja & compliance
- **Weekly caja** state machine, cash-count gate, carry-forward (Epics F-01/02, C-03).
- **Audit report** with four-verdict outcome + official **Excel** generation (Epics F-03/04).
- **Incidents** & notifications (Epic G).
- **Cross-project dashboard** & inter-project transfers (Epics H-02, J).

### Beyond — the platform ahead
- Future modules — **logistics, commercial**, and more — plug into the same identity, access model, and conventions established here.
- Two open questions to confirm with Finance:
  1. How many cajas Finance still spot-checks after automation (Rafa’s preference: still review the final summary of every caja, just faster).
  2. Whether an approval step is wanted right after receipt upload, before weekly submission (Surbhi’s suggestion — not yet resolved).
