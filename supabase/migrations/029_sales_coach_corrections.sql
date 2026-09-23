-- ============================================================
-- 029 — Sales Coach: fact corrections
-- ============================================================
-- Run this on a database that already ran 025-028. Idempotent and safe to
-- re-run.
--
-- Client feedback (CEO, relayed 24 Sep 2026): the AI can mishear a number
-- (e.g. "50,000" vs "15,000") or lack context for a fact that happened off
-- the recording (e.g. a contract signed after the call ended). The Sales
-- Executive should be able to tell the coach the correct fact and regenerate
-- the Report Card with it. This is deliberately NOT the management-review /
-- assessed-position mechanism removed in commit cc1b0b6 at the client's own
-- earlier request — declared outcomes stay trusted outright and interpretive
-- coaching (why a deal went to retorno, etc.) is still entirely the AI's
-- read of the transcript. A correction only ever concerns a hard fact the AI
-- misread, never an outcome judgement, and it never routes to a dispute
-- queue — it's just a fact the analysis is told to treat as ground truth on
-- every future run. See formatCorrectionsBlock() in src/lib/sales-coach.ts
-- and the analyze route, which folds every correction on record into the
-- submission on every regenerate (not just the one that prompted it).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sales_coach_corrections (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    negotiation_id UUID        NOT NULL REFERENCES public.sales_coach_negotiations(id) ON DELETE CASCADE,
    -- NULL = a general/commercial-outcome correction, not tied to one of the
    -- eight scored criteria. Not FK/CHECK-constrained against
    -- SALES_COACH_CRITERIA on purpose — validated in app code instead, so
    -- this migration stays decoupled from that list.
    criterion_key  TEXT,
    field_label    TEXT        NOT NULL,
    -- The AI's original reading, snapshotted at correction time for the
    -- audit trail (not re-derived later, since the card it came from may be
    -- regenerated and overwritten).
    ai_said        TEXT,
    correction     TEXT        NOT NULL,
    submitted_by   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_coach_corrections_negotiation
    ON public.sales_coach_corrections(negotiation_id, created_at);

ALTER TABLE public.sales_coach_corrections ENABLE ROW LEVEL SECURITY;

-- Same ownership pattern as sales_coach_messages: reachable only through a
-- negotiation the caller owns (admins see/manage all). No UPDATE policy —
-- corrections are an immutable log; admins DELETE to undo a mistaken flag.
DROP POLICY IF EXISTS "Users read own negotiation corrections" ON public.sales_coach_corrections;
CREATE POLICY "Users read own negotiation corrections"
    ON public.sales_coach_corrections FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.sales_coach_negotiations n
                WHERE n.id = negotiation_id
                  AND (n.user_id = auth.uid() OR public.user_role() = 'admin'))
    );
DROP POLICY IF EXISTS "Users insert own negotiation corrections" ON public.sales_coach_corrections;
CREATE POLICY "Users insert own negotiation corrections"
    ON public.sales_coach_corrections FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.sales_coach_negotiations n
                WHERE n.id = negotiation_id AND n.user_id = auth.uid())
    );
DROP POLICY IF EXISTS "Admins delete negotiation corrections" ON public.sales_coach_corrections;
CREATE POLICY "Admins delete negotiation corrections"
    ON public.sales_coach_corrections FOR DELETE USING (public.user_role() = 'admin');
