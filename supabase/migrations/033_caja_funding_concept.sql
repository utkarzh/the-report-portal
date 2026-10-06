-- ============================================================
-- 033 — Cash Box: lighter "send funds" form
-- ============================================================
-- Run this on a database that already ran 017-032. Idempotent and safe to
-- re-run.
--
-- Client feedback (Oct 2026):
--
--   1. Evidence is now OPTIONAL when Finance records funds sent to a
--      Director. The admin is the one recording the transfer, so a proof
--      image every time was unnecessary admin work —
--      finance_fundings.proof_image_path becomes nullable.
--
--   2. An optional short concept per funding ("Initial project funds",
--      "Travel budget", "Additional funds – September") so the reason for
--      each transfer is visible in both ledgers — finance_fundings.concept.
--
--   3. The currency the funds were actually sent in. `amount` keeps its
--      existing meaning — what is CREDITED to the project, in the project's
--      settlement currency — so every balance computation is unchanged.
--      sent_amount/sent_currency record the face value when it differs, and
--      exchange_rate is settlement units per 1 sent unit (same direction as
--      finance_transfers.exchange_rate: amount = sent_amount * rate). For a
--      same-currency funding (every existing row) these are amount /
--      settlement_currency / 1.
-- ============================================================

ALTER TABLE public.finance_fundings
    ALTER COLUMN proof_image_path DROP NOT NULL;

ALTER TABLE public.finance_fundings
    ADD COLUMN IF NOT EXISTS concept TEXT;
ALTER TABLE public.finance_fundings
    ADD COLUMN IF NOT EXISTS sent_amount NUMERIC(12, 2);
ALTER TABLE public.finance_fundings
    ADD COLUMN IF NOT EXISTS sent_currency TEXT;
ALTER TABLE public.finance_fundings
    ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(12, 6);

UPDATE public.finance_fundings f
   SET sent_amount   = COALESCE(f.sent_amount, f.amount),
       sent_currency = COALESCE(f.sent_currency, p.settlement_currency),
       exchange_rate = COALESCE(f.exchange_rate, 1)
  FROM public.finance_projects p
 WHERE p.id = f.project_id
   AND (f.sent_amount IS NULL OR f.sent_currency IS NULL OR f.exchange_rate IS NULL);
