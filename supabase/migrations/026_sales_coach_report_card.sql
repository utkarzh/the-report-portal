-- ============================================================
-- 026: Sales Coach Report Card — half-point execution score
-- ============================================================
-- Idempotent — safe to re-run.
--
-- The Report Card scores each applicable criterion as PASS (1 point),
-- WARN (0.5 points) or FAIL (0 points), with N/A and UV criteria excluded from
-- the denominator. A score such as 5.5/7 therefore needs a fractional column.
-- DOUBLE PRECISION (not NUMERIC) so PostgREST returns a JSON number rather
-- than a string.
ALTER TABLE public.sales_coach_negotiations
    ALTER COLUMN execution_score TYPE DOUBLE PRECISION
    USING execution_score::double precision;

COMMENT ON COLUMN public.sales_coach_negotiations.execution_score IS
    'Execution Score recomputed in code from the Report Card criteria: pass = 1, warn = 0.5, fail = 0. N/A and UV criteria are excluded. Half points are valid.';
