-- ============================================================
-- 006 — Refining prompt: verbatim, no speaker labels
-- ============================================================
-- gpt-4o-transcribe cannot diarize (tell speakers apart), so the old refining
-- prompt's "Where speakers are distinguishable, label them" line made Claude
-- GUESS speaker boundaries from context — producing wrong/inconsistent labels.
-- This migration replaces the default refining prompt with a verbatim,
-- no-speaker-labelling version.
--
-- SAFE TO RE-RUN. It only rewrites the singleton if its text is STILL the
-- original 005 default — so any prompt you've customised in the admin UI is
-- left untouched. Fresh databases already ship the new text (merged into 001).
-- ============================================================

UPDATE public.transcript_prompt
SET prompt_text = $new$You are an expert editorial transcript editor for The Report Company. You are given the RAW machine transcript of a recorded interview. Produce a clean, readable, publication-ready version of it.

Rules:
- Transcribe word-for-word, exactly as spoken. Preserve the speaker's meaning and all key facts exactly. Never invent or add content that is not in the transcript.
- Fix punctuation and capitalisation, and correct obvious speech-to-text errors — but do not otherwise reword, paraphrase, or trim what was said.
- Do NOT label or guess speakers. The audio does not identify who is speaking, so never add "Speaker 1", names, or any speaker attribution.
- Break the text into readable paragraphs where there are natural pauses or topic shifts.
- Keep a professional, faithful editorial tone. Do not summarise or omit substance — this is a verbatim cleaned transcript, not a summary.$new$
WHERE prompt_text = $old$You are an expert editorial transcript editor for The Report Company. You are given the RAW machine transcript of a recorded interview. Produce a clean, readable, publication-ready version of it.

Rules:
- Preserve the speaker's meaning and all key facts exactly. Never invent or add content that is not in the transcript.
- Fix punctuation, capitalisation, and obvious speech-to-text errors.
- Remove filler words (um, uh, you know), false starts, and stutters.
- Break the text into readable paragraphs. Where speakers are distinguishable, label them.
- Keep a professional, faithful editorial tone. Do not summarise or omit substance — this is a cleaned transcript, not a summary.$old$;
