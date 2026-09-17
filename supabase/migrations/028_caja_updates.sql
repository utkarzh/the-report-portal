-- ============================================================
-- 028 — Cash Box: receipt exchange-rate proof, cross-currency
--        transfers, verified-only balance
-- ============================================================
-- Run this on a database that already ran 017-027. Idempotent and safe to
-- re-run.
--
-- Three pieces of client feedback land here:
--
--   1. Per-expense exchange rate proof (optional photo of the rate used) —
--      finance_expenses.exchange_rate_proof_path. The rate itself
--      (exchange_rate_used) already existed as a column since 017; what
--      changes is application code no longer forces it to the project's
--      configured rate — see POST /api/finance/projects/[id]/expenses.
--
--   2. Cross-currency inter-project transfers — finance_transfers previously
--      hard-blocked (409) a transfer between two projects with different
--      settlement currencies. amount stays "debited from from_project, in
--      its own currency"; to_amount is new — "credited to to_project, in
--      ITS own currency"; exchange_rate is the conversion used (1 when both
--      projects share a currency, matching every existing row).
--
--   3. Balance timing — REVERSES part of 019's deliberately-documented
--      model. 019 made a pending expense count against the balance the
--      moment it was logged (not just once verified), specifically so the
--      balance wouldn't look artificially healthy mid-week. The client has
--      since asked for the opposite: the balance should only reflect
--      Finance-verified spend. No schema change is needed for this part —
--      see computeBalance()/spendByCategory() in src/lib/finance.ts.
-- ============================================================

ALTER TABLE public.finance_expenses
    ADD COLUMN IF NOT EXISTS exchange_rate_proof_path TEXT;

ALTER TABLE public.finance_transfers
    ADD COLUMN IF NOT EXISTS to_amount NUMERIC(12, 2);
ALTER TABLE public.finance_transfers
    ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(12, 6);

-- Backfill: every existing transfer was same-currency at face value.
UPDATE public.finance_transfers
SET to_amount = amount, exchange_rate = 1
WHERE to_amount IS NULL;

ALTER TABLE public.finance_transfers ALTER COLUMN to_amount SET NOT NULL;
ALTER TABLE public.finance_transfers ALTER COLUMN exchange_rate SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'finance_transfers_to_amount_check'
    ) THEN
        ALTER TABLE public.finance_transfers
            ADD CONSTRAINT finance_transfers_to_amount_check CHECK (to_amount > 0);
    END IF;
END $$;
