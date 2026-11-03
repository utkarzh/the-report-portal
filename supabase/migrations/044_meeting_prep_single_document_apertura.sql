-- ============================================================
-- 044 — Meeting Preparation: one-scroll document + aperturador route
-- ============================================================
-- Run on any database that already ran 014 (and 030). Idempotent, safe to
-- re-run. Client request (Jira SCRUM-47, 2 Nov 2026 — see
-- docs/TRC_Planteo_Aperturadores_Extension_2026-11-01.md and the Loom
-- transcripts next to it):
--
--   1. "Generate the document at once… for each block you put regenerate,
--      edit… just have everything in view." The final assembly pass now
--      writes only the document's first four blocks (Commercial Alert,
--      Snapshot, Motivation ranking, What they've said recently), kept per
--      block in final_sections so one block can be regenerated without
--      touching the others. Presentation points and the planteo are
--      inserted by code from their own columns, as before.
--   2. A third route for meetings with Ministers, heads of industry
--      associations and the like ("aperturadores"), whose planteo is the
--      client's fixed apertura script, seeded below word for word.
--
-- What it adds:
--   - 'aperturador' to meeting_prep_sessions.interviewee_type and the
--     Planteo Library variant CHECKs, plus the seeded aperturador script;
--   - session columns final_sections and auto_pipeline;
--   - meeting_prep_add_usage(): usage totals added in one statement, so two
--     requests finishing together can't drop one of the two updates.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Aperturador route
-- ------------------------------------------------------------
ALTER TABLE public.meeting_prep_sessions
    DROP CONSTRAINT IF EXISTS meeting_prep_sessions_interviewee_type_check;
ALTER TABLE public.meeting_prep_sessions
    ADD CONSTRAINT meeting_prep_sessions_interviewee_type_check
    CHECK (interviewee_type IN ('company_ceo', 'government_official', 'aperturador'));

ALTER TABLE public.meeting_prep_planteo_library
    DROP CONSTRAINT IF EXISTS meeting_prep_planteo_library_variant_check;
ALTER TABLE public.meeting_prep_planteo_library
    ADD CONSTRAINT meeting_prep_planteo_library_variant_check
    CHECK (variant IN ('company_ceo', 'government_official', 'aperturador'));

ALTER TABLE public.meeting_prep_planteo_library_versions
    DROP CONSTRAINT IF EXISTS meeting_prep_planteo_library_versions_variant_check;
ALTER TABLE public.meeting_prep_planteo_library_versions
    ADD CONSTRAINT meeting_prep_planteo_library_versions_variant_check
    CHECK (variant IN ('company_ceo', 'government_official', 'aperturador'));

-- The client's script, word for word. Lines in quotation marks are spoken,
-- lines in capitals are instructions to the representative ("when I put the
-- bold is because these are our instructions to the teams"), and the two
-- "(DOWNLOAD LINK)" lines become downloads of the sample files the client
-- provides, uploaded by an admin under Meeting Preparation → Admin.
INSERT INTO public.meeting_prep_planteo_library (variant, template_text)
SELECT 'aperturador', $seed$"This has been a very insightful interview, with some very important messages to highlight. In particular, it resonated with me when you said (succinctly describe message 1 from the interview), when you highlighted that (message 2 taken from the conversation), and also when you said (message 3).

This conversation is a valuable part of our research on the country, and our editors will use quotes and content from it to build the articles.

We would like this section on the sector to be one of the most important in the publication and to write as many pages as possible about it. Our editorial vision is for this interview with you to play a prominent role in the introductory article, and then to surround you with the most important CEOs in the sector so we can portray the very best minds and companies in the industry.

I have taken the liberty of putting together a list of CEOs to interview, to whom we will also offer the possibility of participating in the commercial dimension so we can write as many pages as possible."

WHILST YOU SAY THE ABOVE PARAGRAPH, HAND OVER THE LIST OF COMPANIES AND ASK:

"Do you think this is a representative list, or would you like to suggest any changes?"

ONCE HE AGREES TO OR EDITS THE LIST, SAY:

"Minister/Sir, would you be so kind as to make friendly introductions to these CEOs and facilitate our meetings with them?"

AGREE ON HOW THE MEETINGS WILL BE FACILITATED AND, WHEN POSSIBLE, SUGGEST A TANGIBLE OUTCOME, SUCH AS A LETTER:

"Sir, leaders like you typically write a note like this (HAND IT OVER FOR HIM TO READ) that can be sent to these companies. Could we proceed in this way?"

MAKE SURE YOU AGREE ON WHO WILL PUT TOGETHER THE LETTERS FOR HIM TO SIGN OR WHO WILL MAKE THE CALLS TO THE COMPANIES, AND WHEN.

You can download a sample 'apertura letter' HERE (DOWNLOAD LINK).

You can download a sample company apertura list format HERE (DOWNLOAD LINK).

Notes and tips

Always hand over apertura letters on a blank sheet. They are meant to be printed on the organisation's official letterhead and signed by the Minister or the leader you are meeting at that organisation.

Have the apertura letter file ready on your phone. Once you have identified the person who will prepare the letter, you can send it to them digitally for them to put it in their official letterhead.

We prefer short, less salesy apertura letters over long-winded ones. The first can be read in a few seconds and is more likely to be perceived as a statement or note rather than a sales endorsement. The probability of getting it signed is therefore higher.

Always print out two copies of the company apertura list. Hand one to the Minister (aperturador) and keep one yourself. You must annotate all the changes he/she makes to the list so there is alignment on the final list of companies to open. If the Minister writes on his list, make sure you take a photo of it and then leave it with him so he can pass it on to his team. In this way, his handwriting will serve as evidence that he agreed to the list.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.meeting_prep_planteo_library WHERE variant = 'aperturador');

-- ------------------------------------------------------------
-- 2. Session columns
-- ------------------------------------------------------------
-- final_sections: the four AI-written document blocks
--   { commercial_alert, snapshot, motivation, said_recently }
-- auto_pipeline: true for sessions created after this change. The workspace
--   carries such a session on to the finished document by itself; older
--   sessions paused mid-way show a button instead, so opening an old page
--   never spends anything on its own.
ALTER TABLE public.meeting_prep_sessions
    ADD COLUMN IF NOT EXISTS final_sections JSONB,
    ADD COLUMN IF NOT EXISTS auto_pipeline  BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- 3. Atomic usage totals
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meeting_prep_add_usage(
    p_session       UUID,
    p_tokens_input  INTEGER,
    p_tokens_output INTEGER,
    p_web_searches  INTEGER,
    p_cost          NUMERIC
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.meeting_prep_sessions
       SET tokens_input  = COALESCE(tokens_input, 0)  + COALESCE(p_tokens_input, 0),
           tokens_output = COALESCE(tokens_output, 0) + COALESCE(p_tokens_output, 0),
           tokens_total  = COALESCE(tokens_total, 0)  + COALESCE(p_tokens_input, 0) + COALESCE(p_tokens_output, 0),
           web_searches  = COALESCE(web_searches, 0)  + COALESCE(p_web_searches, 0),
           cost_usd      = COALESCE(cost_usd, 0)      + COALESCE(p_cost, 0)
     WHERE id = p_session;
$$;

REVOKE ALL ON FUNCTION public.meeting_prep_add_usage(UUID, INTEGER, INTEGER, INTEGER, NUMERIC) FROM PUBLIC, anon, authenticated;
