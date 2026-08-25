-- ============================================================
-- 019 — Cash Box: corrected ledger model
-- ============================================================
-- Run this on a database that already ran 017 and 018. Idempotent and safe
-- to re-run. See docs/cashbox-requirements.md and the corrected flow agreed
-- with the client (superseding the weekly-caja-state-machine approach from
-- 018 as the primary UX — those tables stay, unused by the main flow, so
-- nothing already written is destroyed).
--
-- Corrected model:
--   - An expense affects the project balance the moment it's logged
--     (status IN ('pending','verified')) — never gated behind approval.
--     Rejecting reverses it. This requires no schema change (computeBalance
--     just changed which statuses count — see src/lib/finance.ts) but the
--     fields below support the rest of the corrected flow.
--   - Removing a team member, or deleting their account entirely, must
--     never break historical display of what they logged — profiles.id is
--     ON DELETE SET NULL, so the display name is snapshotted at write time.
--   - The accommodation nightly cap depends on team size (client doc:
--     $70/night for a 1-person project, $110/night for 2 people) — this was
--     a flat guess before.
--   - The AI now always leaves a one-line human-readable comment per
--     expense (not just when something looks wrong), since Finance reviews
--     that comment directly in the transaction list.
-- ============================================================

ALTER TABLE public.finance_expenses
    ADD COLUMN IF NOT EXISTS logged_by_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.finance_expenses
    ADD COLUMN IF NOT EXISTS ai_note TEXT;
ALTER TABLE public.finance_expenses
    ADD COLUMN IF NOT EXISTS sub_line TEXT;

-- Backfill existing rows so pre-migration expenses still show a name
-- (best-effort — profile may already be gone).
UPDATE public.finance_expenses e
SET logged_by_name = COALESCE(p.full_name, p.email, 'Unknown')
FROM public.profiles p
WHERE e.logged_by = p.id AND e.logged_by_name = '';

-- traveler_count: the accommodation-nightly-cap feature this fed was removed
-- (it only had a rule for 1-2 travelers, and the project's actual team size —
-- Director + any number of Sales Reps — is unrelated to overnight-room
-- headcount; the guide never covers 3+). Left in place, unused, rather than
-- dropped — same call as the superseded caja-state-machine tables above.
ALTER TABLE public.finance_projects
    ADD COLUMN IF NOT EXISTS traveler_count INTEGER NOT NULL DEFAULT 1
        CHECK (traveler_count IN (1, 2));
ALTER TABLE public.finance_projects
    ADD COLUMN IF NOT EXISTS local_currency TEXT NOT NULL DEFAULT '';
