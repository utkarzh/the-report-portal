# TRC Live Coach — Test Results and Technical Answers

Reply to *TRC Live Coach — Development Requirements v1.0* (13 November 2026) · 18 November 2026

## 1. Where we are

- **Your Master Behaviour Prompt v1.0 is live, word for word.** We checked it character by character against your Word file. Every Live Coach call since 18 November runs on it.
- **It's editable without us.** It's in Sales Coach → Admin tools → Live Coach Instructions, and only you, Elizabeth and Utkarsh can edit it. Every save is versioned and can be rolled back. A change applies from the next call, so a call already running keeps the rules it started with.
- **Nothing in the Development Requirements is built yet.** As your sequence asks, this document covers step 2 (sample conversations) and step 1 (your open technical confirmations), for your approval before we build.

## 2. Sample conversations

We ran three test calls on real Report Cards. Each call got exactly the instructions a real call gets. The executive's lines were typed rather than spoken, and nothing was saved.

| Test | Report Card | What we asked |
|---|---|---|
| 1 | Manuchar (CEO deferred to marketing in Belgium) | "Let's do a role play", then a weak answer, pause, resume, retry, end and review |
| 2 | Domus Windows and Doors | Practise an objection: "your price is more than a full-page ad in the newspaper", with a hint |
| 3 | KC Confectionery | Ordinary questions only, then "Can you play him so I can rehearse my follow-up call next week?" |

**What followed your prompt**

- "Let's do a role play" went straight into replaying the meeting from the Report Card. The CEO raised the real objections: Belgium decides, budget at year-end, wants a mock-up. The coach announced that it was now playing the CEO.
- Generic objection practice worked. On "Hint" it coached from the Manual's own section on "prices are higher than advertising directly".
- Ordinary questions got ordinary answers: no role play, no score, and every answer was grounded in the TRC documents.
- Roles were always labelled: "Coach here", "As CEO, I'd say", "Back to CEO mode".
- The end-of-role-play reviews gave a practice score (7/10 in both tests), what went well, the main misses, better wording, the outcome and one practice recommendation. After a retry, it credited the improvement without hiding the first mistake.

**What did not follow your prompt**

1. **The opening.** In all three tests, and in a real call made the same day, the coach opened with a 100–150 word monologue. It offered the app's two coaching tracks ("work on the meeting, or plan the next commercial step") instead of your two role-play types. That conflicts with "Be concise" and "Do not monologue".
2. **It interrupted a role play by itself once.** After the executive's weak "I'll send the proposal to marketing in Belgium", it stepped out of the CEO role to coach. Your prompt says coaching only when the executive asks, and never rescue them in CEO mode.
3. **"Retry that objection"** got more coaching, rather than the CEO restating the objection.
4. **After "resume"**, the CEO moved the conversation forward (softened and stated a preference) rather than continuing exactly where it paused.
5. **Asked to rehearse the next real call with the client, it did.** Your prompt says not to offer this as a default or suggested mode, but doesn't say what to do when someone asks for it directly. The Development Requirements put it out of scope.

**Why, as far as we can tell.** Besides your prompt, the coach also receives the app's general coaching instructions. They were written before your prompt and are shared with the written coach in the Coaching tab. Your prompt comes last and the coach is told it takes precedence. But your prompt doesn't say how to open a call, so on the opening the older instructions fill the gap. Points 2–4 are what the buttons in Features 1–2 are for: with buttons, the app tells the coach exactly which mode it's in, instead of leaving it to interpret the conversation.

**Decisions for you**

- **The opening:**
  - (a) You add a line to your prompt saying how the coach should open a call. These are your words, and it needs no development.
  - (b) We remove the app's general coaching instructions from live calls, so your prompt is the only instruction on how the coach behaves. The TRC documents, Report Card and transcript stay. It's a small change. Those instructions also carry a few safeguards: never re-score the Report Card, never invent CEO commitments, and remember the platform can't send messages. Your prompt covers most of these, but not all.
  - (c) Leave it as it is.
- **Rehearsing the next real call:** should the coach refuse when someone asks for it directly, or allow it?

## 3. A limit that affects every feature

OpenAI limits this account to **200,000 tokens per minute** for live voice, shared by the whole company. Each coach reply sends about 52,000 tokens: the five TRC documents (about 45,000), the Report Card, the transcript and your prompt (about 3,500). That allows only **3–4 coach replies per minute across all users**. A brisk role play by one person can hit it, and two people on calls at the same time certainly will. Today, when it's hit, the coach simply doesn't answer, with no message.

Options:

- **Raise the limit.** OpenAI's next tier allows 4,000,000 tokens per minute. Tiers rise automatically as total spend on the account grows, so we'll check exactly what it takes.
- **Show the wait.** Say "the coach needs a few seconds" and retry by itself. We'd do this anyway under Feature 4.
- **Send less with each reply,** for example shorter versions of the documents. That changes what the coach knows, so it's your decision.

Cost for reference: about $0.07 per coach reply, so a 10-minute role play costs roughly $1–1.50. The three test calls cost $1.63 in total.

## 4. Answers to your open technical confirmations

**What voice SDK and conversation/session persistence mechanisms are in use?**
OpenAI's Realtime API (model gpt-realtime-2.1). The call runs directly between the browser and OpenAI, for up to 15 minutes. Within a call, everything said is the coach's memory. When a call ends, its text is saved into the negotiation's coaching chat, and the next call or written chat starts from it.

**Can the UI reliably interrupt playback and switch model roles within one session?**
Yes to interrupting: the app can stop the coach mid-sentence instantly, and the executive can already talk over it. For roles, the same model plays both the CEO and the Coach. A button would stop the audio and tell the coach, inside the same conversation, which mode it's now in, so the full role-play context is kept for resume and retry. The voice itself can't change within a call (see Feature 6).

**Where will scores/reviews be stored, and what are existing user permissions and retention policies?**
In a new table in our database, linked to the executive and, when there is one, the Report Card. The executive sees their own reviews; the admins see all. **Please confirm one thing:** today the spoken words of every Live Coach call (both sides, as text, never audio) are already saved into that negotiation's coaching chat and kept, visible to the executive and the admins. That's also how the next call continues where the last one left off. Your requirements say full transcripts should only be kept under an approved policy, so we need your decision: keep this, or stop saving call text.

**Can the prompt version be stored alongside each review?**
Yes. Each review would record which version of your prompt was live when the call started, and when that version was saved.

**What effort estimate and implementation sequence does the developer recommend?**

| Feature | What we'd build | Estimate |
|---|---|---|
| 5. Draft → publish | Save a draft without affecting calls, publish it explicitly, show the active version and its date | 1 day |
| 1. Launch controls | "Replay this meeting" and "Practise an objection" (easy / intermediate / advanced); current mode always shown | 2 days |
| 2. Pause, resume, retry, end | Buttons that stop the coach and set its mode; retries marked for the review; voice commands keep working; dropped calls handled | 3 days |
| 4. Interface states | Mic and mode status, the review screen, clear busy / reconnect / save-error messages, keyboard and mobile | 2 days |
| 3. Saved reviews | Review saved in structured form (score, strengths, improvements, practice, pauses/retries, prompt version); a "My role plays" list; a failed save shows an error and can be retried | 3 days |
| 6. CEO voices | A different voice per call (option b below) | 1 day, optional |
| Testing | On real Report Cards and generic objections, before your approval | 2 days |

About 13–14 working days in total. We suggest building in this order: 5, then 1, 2 and 4 together (one working role-play experience to demonstrate), then 3, with 6 only if you want it.

**Does an admin-editable prompt configuration already exist?**
Yes. Since 13 November there has been a Live Coach document in the admin area. It now holds your prompt, word for word. It's limited to you, Elizabeth and Utkarsh, versioned with rollback, and applies to new calls only. What's missing is the separate draft → publish step and a visible "active since" date (Feature 5 above).

## 5. Feature 6: different CEO voices

- **A different voice for each call: possible.** The voice is chosen when a call starts.
- **Separate CEO and Coach voices within one call: not possible with this provider.** OpenAI fixes the voice once the coach has spoken in a call.

Options:

- **(a) One voice, with a spoken cue.** "Coach here" / "Back to CEO mode" is already working in the tests. No cost.
- **(b) A different professional voice for each role-play call,** kept for the whole call, Coach mode included. About 1 day, no extra running cost.
- **(c) Separate CEO and Coach voices** by running two linked sessions. This roughly doubles the cost, adds a delay at every switch and adds more points of failure, so we don't recommend it.

We suggest (a) now, with (b) if you'd like the variety.
