-- ============================================================
-- 020 — Cash Box: per-project AI checking rules
-- ============================================================
-- Idempotent, safe to re-run. Adds a free-text rules field the admin sets
-- when creating a project (e.g. "don't count weekend expenses", "no taxi
-- over $40") — fed into both AI receipt passes (extraction + the
-- confirm-time re-verification, see lib/finance-ai.ts) as strict,
-- project-specific requirements, not just style guidance.
-- ============================================================

ALTER TABLE public.finance_projects
    ADD COLUMN IF NOT EXISTS ai_rules TEXT NOT NULL DEFAULT '';
