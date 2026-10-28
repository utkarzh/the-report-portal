-- ============================================================
-- 042 — Cash Box: ticket comment threads, several attachments per
--        funding
-- ============================================================
-- Run this on a database that already ran 017-041. Idempotent and safe to
-- re-run. Deploy the code that uses it only after it has run: recording
-- funds writes proof_files, and the ticket thread reads/writes
-- finance_expense_comments.
--
-- Client feedback (Office Manager, 26 Oct 2026):
--
--   1. "I can only upload one file as proof of a funds transfer" —
--      finance_fundings.proof_files holds every attached file as
--      [{ "path": "<project_id>/…", "name": "bank-transfer.pdf" }].
--      proof_image_path is kept, mirrored to the first file, so nothing that
--      still reads it breaks; proof_files is the source of truth.
--
--   2. Comments on tickets — a rejected ticket may be correct as it is (a
--      taxi on a Saturday because a meeting took place), so the field user
--      must be able to reply and send it back without uploading a new
--      receipt, and a ticket can carry the uploader's own explanation from
--      the start instead of it being squeezed into the concept.
--      finance_expense_comments is one append-only thread per expense:
--        kind 'comment'      — a message from either side (incl. the note
--                              typed when the ticket was submitted)
--        kind 'rejection'    — Finance rejected it; message = the reason
--        kind 'resubmission' — the field user sent it back for review,
--                              with a reply and/or corrected values
--      author_name/author_side are snapshotted, like logged_by_name, so the
--      thread stays legible after a profile is deleted.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Several attachments per funding
-- ------------------------------------------------------------
ALTER TABLE public.finance_fundings
    ADD COLUMN IF NOT EXISTS proof_files JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.finance_fundings
   SET proof_files = jsonb_build_array(jsonb_build_object('path', proof_image_path, 'name', 'Evidence'))
 WHERE proof_image_path IS NOT NULL
   AND proof_files = '[]'::jsonb;

-- ------------------------------------------------------------
-- 2. Ticket comment threads
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_expense_comments (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_id  UUID        NOT NULL REFERENCES public.finance_expenses(id) ON DELETE CASCADE,
    author_id   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    author_name TEXT        NOT NULL DEFAULT '',
    author_side TEXT        NOT NULL CHECK (author_side IN ('finance', 'field')),
    kind        TEXT        NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'rejection', 'resubmission')),
    message     TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_expense_comments_expense
    ON public.finance_expense_comments(expense_id, created_at);

ALTER TABLE public.finance_expense_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance admins manage expense comments" ON public.finance_expense_comments;
CREATE POLICY "Finance admins manage expense comments"
    ON public.finance_expense_comments FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read comments on their own project expenses" ON public.finance_expense_comments;
CREATE POLICY "Members read comments on their own project expenses"
    ON public.finance_expense_comments FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.finance_expenses e
        WHERE e.id = expense_id AND public.is_finance_project_member(e.project_id)
    ));
DROP POLICY IF EXISTS "Members comment on their own project expenses" ON public.finance_expense_comments;
CREATE POLICY "Members comment on their own project expenses"
    ON public.finance_expense_comments FOR INSERT
    WITH CHECK (
        author_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.finance_expenses e
            WHERE e.id = expense_id AND public.is_finance_project_member(e.project_id)
        )
    );

-- Backfill: every ticket currently rejected starts its thread with the
-- rejection it already carries, so the reason doesn't vanish from the
-- history once the field user replies and sends it back.
INSERT INTO public.finance_expense_comments (expense_id, author_id, author_name, author_side, kind, message, created_at)
SELECT e.id,
       e.reviewed_by,
       COALESCE(NULLIF(p.full_name, ''), p.email, 'Finance'),
       'finance',
       'rejection',
       e.rejection_reason,
       COALESCE(e.reviewed_at, e.updated_at)
  FROM public.finance_expenses e
  LEFT JOIN public.profiles p ON p.id = e.reviewed_by
 WHERE e.status = 'rejected'
   AND e.rejection_reason IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM public.finance_expense_comments c
        WHERE c.expense_id = e.id AND c.kind = 'rejection'
   );
