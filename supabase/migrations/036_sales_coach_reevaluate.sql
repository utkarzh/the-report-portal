-- ============================================================
-- 036 — Sales Coach: "Re-evaluate" lineage
--
-- Idempotent, safe to re-run. "Re-evaluate" (POST
-- /api/sales-coach/[id]/reevaluate) copies an existing negotiation — every
-- submitted field, the transcript (and its audio + timestamps) and any fact
-- corrections — into a NEW negotiation and generates a fresh Report Card on
-- it, so nobody refills the form or waits for transcription again. The
-- original and its card stay untouched.
--
-- reevaluated_from points every re-evaluation at the ORIGINAL submission
-- (re-evaluating a re-evaluation still points at the original), which is how
-- the UI marks a copy as a re-evaluation, links back to the original, and
-- offers "open the latest Report Card" from older ones. SET NULL so deleting
-- the original never deletes its re-evaluations.
--
-- The app keeps working before this runs: every query that names the column
-- retries without it (see isMissingReevaluatedColumn() in
-- src/lib/sales-coach.ts) — re-evaluate still works, only the markers/links
-- are missing until then.
-- ============================================================

ALTER TABLE public.sales_coach_negotiations
    ADD COLUMN IF NOT EXISTS reevaluated_from UUID
        REFERENCES public.sales_coach_negotiations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_coach_negotiations_reevaluated_from
    ON public.sales_coach_negotiations(reevaluated_from);
