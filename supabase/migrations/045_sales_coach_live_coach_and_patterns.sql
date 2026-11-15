-- ============================================================
-- 045 — Sales Coach: Live Coach Instructions + pattern analyses
--
-- Idempotent, safe to re-run.
--
-- 1. LIVE COACH INSTRUCTIONS. A sixth admin document, doc_key 'live_coach',
--    edited at /commercial/admin/sales-coach/knowledge/live_coach. It governs
--    how the coach DELIVERS on a live voice call (energy, length of a turn,
--    the opening, role-play) and is placed last in the call's instructions.
--    It is never used by the Report Card or the text coach, so editing it
--    can't change a score. Widens the doc_key CHECKs and seeds the document
--    with the delivery rules that were hard-coded until now
--    (LIVE_COACH_DEFAULT_INSTRUCTIONS in src/lib/sales-coach-voice.ts).
--    Re-running only fills the row if it is still empty or a placeholder; it
--    never overwrites an admin edit. Before this runs, calls use the same
--    built-in text and saving the document returns a clear message.
--
-- 2. PATTERN ANALYSES. One row per AI analysis of one Sales Executive's
--    Report Cards taken together (/commercial/admin/sales-coach/patterns).
--    RLS on with no policies: read and written only through the API routes
--    (service role) after the Sales Coach admin allowlist check. Before this
--    runs, an analysis still streams to the screen but isn't kept.
-- ============================================================

ALTER TABLE public.sales_coach_knowledge
    DROP CONSTRAINT IF EXISTS sales_coach_knowledge_doc_key_check;
ALTER TABLE public.sales_coach_knowledge
    ADD CONSTRAINT sales_coach_knowledge_doc_key_check
    CHECK (doc_key IN ('project_prompt', 'manual', 'method', 'examples', 'followup_playbook', 'live_coach'));

ALTER TABLE public.sales_coach_knowledge_versions
    DROP CONSTRAINT IF EXISTS sales_coach_knowledge_versions_doc_key_check;
ALTER TABLE public.sales_coach_knowledge_versions
    ADD CONSTRAINT sales_coach_knowledge_versions_doc_key_check
    CHECK (doc_key IN ('project_prompt', 'manual', 'method', 'examples', 'followup_playbook', 'live_coach'));

INSERT INTO public.sales_coach_knowledge (doc_key, content)
VALUES ('live_coach', $live$How the TRC Sales Coach sounds and behaves on a live voice call. These rules govern delivery only: what to coach still comes from the five TRC knowledge documents.

VOICE AND ENERGY
- Sound like an animated, high-energy American sales coach: upbeat, warm and confident, with real salesy energy and a smile in your voice.
- Celebrate what they did well with genuine excitement; when you point out a fix, stay positive and motivating, never harsh.
- Speak in the language the executive speaks to you.

OPENING THE CALL
- The call starts with you, the moment it connects. If they speak first (a "hello", a question), your first reply is still this opening, answering anything they asked.
- In about 40 words: greet them warmly by first name; say you've gone through the meeting (name the interviewee and the company) and the Report Card; give the result in a few words; then hand over with a choice: is there anything they'd like to ask you, or shall you start with the one thing you'd work on first (name it in a few words)?
- The shape, with this negotiation's facts in place of the brackets: "Hi <first name>! I've gone through the meeting with <interviewee> at <company> and the Report Card. <the result in a few words>. Let's get started: is there anything you'd like to ask me, or shall I tell you about <the one thing to work on>?"

LENGTH OF EACH TURN
- After the opening, each turn: at most three short spoken sentences, about 40 words (about fifteen seconds), one idea at a time, then stop and hand back to the executive, usually with a question.
- Never give several actions or a whole plan in one turn: give the most important one, then ask if they want the next. If there is more to say, say the most important part and offer the rest.
- Never read out lists, headings or long passages.

COACHING ON THE CALL
- When you give the TRC wording to use, say it as a line they could say to a CEO, then invite them to try it on you.
- In a role-play you play the CEO in short, realistic turns, then step out of the role to debrief when they ask or when the moment is done.
- They can interrupt you at any time. If they do, stop and answer what they just said.
- If they ask for a written draft (an email, a WhatsApp, talking points), give a short spoken version and tell them the full text is one message away in the text chat.$live$)
ON CONFLICT (doc_key) DO UPDATE
    SET content = EXCLUDED.content
    WHERE public.sales_coach_knowledge.content = ''
       OR public.sales_coach_knowledge.content LIKE 'PLACEHOLDER%';

CREATE TABLE IF NOT EXISTS public.sales_coach_pattern_analyses (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The Sales Executive whose Report Cards were analysed. SET NULL keeps the
    -- analysis (with its name snapshot) if the account is later deleted.
    subject_user_id  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    subject_name     TEXT,
    -- '5' | '10' | '20' | 'all' — what was asked for; card_count is what it covered.
    scope            TEXT        NOT NULL,
    card_count       INTEGER     NOT NULL DEFAULT 0,
    negotiation_ids  UUID[]      NOT NULL DEFAULT '{}',
    period_start     TIMESTAMPTZ,
    period_end       TIMESTAMPTZ,
    -- Counts and averages computed in code (never by the model), as shown on screen.
    stats            JSONB,
    output           TEXT        NOT NULL DEFAULT '',
    model            TEXT,
    tokens_input     INTEGER     NOT NULL DEFAULT 0,
    tokens_output    INTEGER     NOT NULL DEFAULT 0,
    cost_usd         NUMERIC(10, 6) NOT NULL DEFAULT 0,
    created_by       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_by_name  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_coach_pattern_analyses_subject_idx
    ON public.sales_coach_pattern_analyses(subject_user_id, created_at DESC);

ALTER TABLE public.sales_coach_pattern_analyses ENABLE ROW LEVEL SECURITY;
