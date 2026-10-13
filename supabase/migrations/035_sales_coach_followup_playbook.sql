-- ============================================================
-- 035 — Sales Coach: fifth knowledge document
-- (TRC Post-Meeting Follow-Up & Conversion Playbook)
--
-- Idempotent, safe to re-run. Widens the doc_key CHECK on the knowledge
-- table and its versions table to allow 'followup_playbook', and seeds the
-- Playbook as delivered by TRC (Oct 2026). Re-running only fills the row if it
-- is still empty or a placeholder — it never overwrites an admin edit made at
-- /commercial/admin/sales-coach/knowledge/followup_playbook.
--
-- The Playbook sits FIFTH in the authority order and only governs
-- post-meeting conversion coaching — it is never used to score the recorded
-- negotiation (see SALES_COACH_KNOWLEDGE_DOCS in src/lib/sales-coach.ts).
-- ============================================================

ALTER TABLE public.sales_coach_knowledge
    DROP CONSTRAINT IF EXISTS sales_coach_knowledge_doc_key_check;
ALTER TABLE public.sales_coach_knowledge
    ADD CONSTRAINT sales_coach_knowledge_doc_key_check
    CHECK (doc_key IN ('project_prompt', 'manual', 'method', 'examples', 'followup_playbook'));

ALTER TABLE public.sales_coach_knowledge_versions
    DROP CONSTRAINT IF EXISTS sales_coach_knowledge_versions_doc_key_check;
ALTER TABLE public.sales_coach_knowledge_versions
    ADD CONSTRAINT sales_coach_knowledge_versions_doc_key_check
    CHECK (doc_key IN ('project_prompt', 'manual', 'method', 'examples', 'followup_playbook'));

INSERT INTO public.sales_coach_knowledge (doc_key, content)
VALUES ('followup_playbook', $playbook$TRC Sales Coach
Post-Meeting Follow-Up & Conversion Playbook
Knowledge Document 5 | TRC Commercial Methodology
1. Purpose
This document defines TRC's methodology for converting unsigned sales negotiations (retornos) into signed contracts.
The objective is to maximise conversion after a Planteo meeting by maintaining commercial momentum, reinforcing the editorial value of participation, involving the CEO appropriately and securing a clear path to signature.
A signed agreement on the spot remains the preferred outcome. Follow-up is the second-best scenario and must be managed actively.
This document governs post-meeting conversion coaching. The existing TRC Coaching Method, Overcoming Objections Manual and Successful Negotiation Examples continue to govern their respective areas.
The AI Sales Coach must apply this methodology to the actual negotiation and subsequent information provided by the Sales Executive. It must not treat every retorno as requiring the same sequence of actions.
2. Establish the Real Commercial Position
Before recommending follow-up actions, determine what was genuinely achieved during the meeting.
The most important distinction is between CEO interest and CEO buy-in.
Expressions of interest do not establish buy-in:
• "This is interesting."
• "I like the idea."
• "Send me some information."
• "Speak to my marketing team."
• "We will consider it."
Stronger evidence of buy-in includes:
• "I want to participate."
• "In principle, I would like to be included."
• "I would prefer the half-page option."
• The CEO instructs marketing to proceed with a defined participation.
• The CEO identifies who will complete or sign the agreement and authorises that process.
Assess the full conversation, including qualifications, objections and subsequent conduct. Do not interpret courtesy or general enthusiasm as a commitment.
The AI must distinguish between:
1. Genuine CEO buy-in.
2. CEO preference for a particular space and investment.
3. Who has authority to decide and sign.
4. Whether marketing is implementing a CEO decision or making a decision that remains open.
5. The agreed next step and its timing.
These distinctions determine the appropriate follow-up strategy.
3. Secure the Strongest Possible Retorno Before Leaving
When an agreement cannot be signed during the initial meeting, the Sales Executive should try to leave with the strongest possible commercial position.
Ideally, this means:
• Explicit CEO buy-in.
• One or two specific participation options and their prices.
• A clear CEO preference where possible.
• Identification of the person responsible for completing the agreement.
• A direct introduction to that person.
• A scheduled follow-up meeting with a specific date and time.
• A clear understanding of what remains to be decided.
Avoid allowing an otherwise promising negotiation to finish with an undefined instruction to "send something."
If the CEO requests a proposal, first clarify exactly what they want to see. Where appropriate, attempt to resolve the remaining decision during the meeting rather than automatically postponing it.
4. Preferred Follow-Up: A Second Meeting With the CEO
When genuine buy-in exists, the preferred approach is to secure a brief second meeting with the CEO before leaving the initial meeting.
Target: Approximately 10–15 minutes, ideally the following day or within 48 hours.
The purpose is to revisit the interview content, reinforce its editorial value and return to the commercial decision.
Prepare:
• The polished interview transcript.
• Selected passages highlighting the CEO's strongest messages.
• Where appropriate, one or two preliminary visual layouts.
• The specific participation option or options already discussed.
During the second meeting:
1. Review the strongest editorial messages with the CEO.
2. Reinforce why those messages deserve visibility in the publication.
3. Show a relevant visual layout if available.
4. Revisit the participation option discussed previously.
5. Ask for the remaining commercial decision or signature.
The second meeting should build on the first conversation, not restart the entire sales presentation.
A short coffee meeting may also be appropriate when the relationship and circumstances support it.
5. When a Second CEO Meeting Is Not Possible
If the CEO cannot meet again, the Sales Executive should seek to:
• Obtain the CEO's direct WhatsApp contact, where appropriate.
• Secure an introduction to the relevant marketing or communications executive.
• Schedule a meeting with that person.
• Keep the CEO informed through selective, concise communications.
WhatsApp is generally preferable to email for brief, timely CEO follow-up when direct contact has been established.
The objective is to preserve CEO ownership of the commercial decision while allowing the appropriate team to handle implementation.
Avoid excessive messages or unnecessary requests for the CEO's attention.
6. Follow Up Quickly With the Interview Transcript
Speed is an important element of TRC's follow-up methodology.
Where there is a genuine commercial opportunity, the Sales Executive should aim to send the polished interview transcript promptly, ideally within 60–120 minutes after the meeting, when operationally possible.
The interview is still fresh in the CEO's mind. A fast, professional follow-up reinforces the quality of TRC's work and keeps the editorial discussion active.
The message should be brief, natural and focused on editorial value.
Illustrative WhatsApp message:
"Thank you again for the interview. I'm sharing the transcript for your factual review. I've highlighted a few of the strongest messages, which I think will work particularly well in the publication. I'm also coordinating the next steps with your marketing team."
Adapt the wording to what actually occurred. Never claim that an editorial team has reviewed or praised the material unless this is true.
Important distinction: TRC routinely uploads interview transcripts to its platform, but this does not mean every transcript should automatically be sent to every prospect as a commercial follow-up.
Prioritise active opportunities with credible CEO interest or buy-in.
7. Editorial Fact-Checking Versus Approval
Maintain a clear distinction between factual review and editorial approval.
For an interviewee who has not purchased dedicated coverage, the transcript may be shared for fact-checking.
This does not grant the interviewee editorial approval rights over TRC's content.
Where a client has purchased dedicated coverage, the applicable contractual and editorial arrangements determine the approval process.
The Sales Coach must not recommend promising editorial approval as an inducement to purchase unless that right genuinely exists.
8. Use Visual Layouts Selectively
For opportunities with genuine CEO buy-in, a preliminary visual can help the CEO understand how the company's participation may appear.
The graphic design team may prepare one or two concise visual teasers, rather than a complete generic presentation.
Depending on the option discussed, these may show:
• A Q&A-led presentation featuring the CEO.
• An article-led corporate profile.
• The CEO's photograph.
• The company's logo.
• The relevant space or format discussed during the meeting.
The layout should reflect the actual commercial proposal and available editorial material.
The transcript and its editorial messages remain the primary selling assets. The visual reinforces their value.
Where appropriate, send the CEO a short WhatsApp with the visual before the marketing meeting, keeping the CEO informed without creating unnecessary pressure.
9. Prepare the Marketing Meeting
Where marketing is involved, provide relevant material in advance when useful, potentially one or two hours before the scheduled meeting.
This may include the transcript, selected editorial highlights and the proposed visual.
The marketing meeting should follow this sequence:
First: Editorial value. Begin with the CEO's strongest interview messages and explain why they deserve visibility. Reconnect the discussion to what the CEO wanted to communicate.
Second: Visual presentation. Show how those messages could appear in the proposed coverage.
Third: Commercial decision. Return to the one or two spaces and prices already discussed with the CEO.
Fourth: Completion. Clarify the remaining approval, signatory, documentation and timing needed to secure the agreement.
The Sales Executive should not automatically restart the full Planteo or present a broad menu of unrelated options.
Where the CEO has already expressed a preference, treat it as the starting point for the discussion while remaining accurate about whether the preference was an actual commitment.
10. When the CEO Requests a Proposal
"Send me a proposal" should not automatically be treated as a successful commercial outcome.
Before leaving the meeting, clarify:
• What exactly does the CEO want to receive?
• Which space or option is under consideration?
• Is the investment understood?
• Who will review or approve the proposal?
• When will a decision be made?
Where possible, use these questions to advance the negotiation immediately.
If a proposal is required, send a short, tailored email, not an unnecessarily long generic presentation.
Include:
• The publication and project.
• The one or two participation options discussed.
• The corresponding prices.
• The principal deliverables.
• The media kit as an attachment.
• A specific next step.
Copy the CEO where appropriate.
When the CEO has clearly selected an option and the commercial position supports it, a pre-filled digital contract may be sent for review so that signature becomes the natural next step.
This should be presented as a practical way to complete an already discussed decision, not as evidence that an agreement exists when it does not.
11. Maintain CEO Involvement Without Undermining Marketing
Marketing may be responsible for budgets, documentation, approvals or implementation. The Sales Executive should respect that role.
However, if the CEO has expressed genuine buy-in, the Sales Executive should avoid allowing the opportunity to lose momentum through an uncontrolled handoff.
When marketing stalls:
1. Identify the actual obstacle.
2. Determine whether it can be resolved directly with marketing.
3. Where appropriate, send the CEO a concise factual update.
4. Ask the CEO to help clarify or advance the decision if their involvement is genuinely needed.
For example:
"We've reviewed the proposed half-page participation with your marketing team, but the final selection is still pending. Would you be comfortable confirming which option you would prefer us to prepare?"
The wording must reflect the actual conversation and the CEO's level of commitment.
Repeated CEO non-response is a meaningful commercial signal. The Sales Executive should reassess the probability of conversion rather than continue indefinitely with the same approach.
12. Prioritise Actions According to the Strength of the Retorno
Not all retornos justify the same investment of time and resources.
Strong retorno: Explicit CEO buy-in, defined participation, clear stakeholders and an active next step. Prioritise rapid transcript delivery, selective visuals, direct CEO engagement and completion of the contract.
Intermediate retorno: Meaningful interest, but preference, authority or process remains unresolved. Prioritise clarifying the missing commitment and establishing a controlled next step before investing heavily in materials.
Weak retorno: General courtesy, no defined option, no meaningful commitment and no controlled follow-up. Do not treat this as an advanced negotiation. Identify whether a credible route to CEO engagement remains before committing substantial resources.
These are qualitative coaching distinctions, not additional Report Card scoring categories.
13. How the AI Sales Coach Must Apply This Playbook
For every unsigned negotiation, the AI should use the Report Card and subsequent coaching conversation to help the Sales Executive convert the specific opportunity, not merely reflect on past performance.
The Coach must:
Diagnose the position. Review the transcript, declared outcome and available follow-up information. Distinguish established facts from interpretations.
Ask targeted questions where necessary. For example:
• Did the CEO explicitly agree in principle to participate?
• Which space and price were discussed?
• Did the CEO express a preference?
• Who can approve or sign?
• Did the CEO introduce you to marketing?
• Is a follow-up meeting scheduled?
• Has the transcript been shared?
• What has happened since the meeting?
Ask only questions necessary to determine the next action. Do not turn the coaching conversation into a rigid questionnaire.
Prioritise next steps. Recommend the most useful actions for that particular deal, including what to do, why it matters, when to act and how to approach it.
Provide usable commercial material. When requested, draft concise WhatsApp messages, follow-up emails, meeting talking points, proposal summaries, visual-layout briefs or suggested closing language.
Adapt as circumstances change. When the Sales Executive reports a marketing objection, CEO response, missed meeting or new commitment, reassess the strategy using the new facts.
Preserve evidence discipline. Never claim the CEO committed, selected a space or authorised a contract unless the evidence supports that conclusion.
Separate two coaching objectives:
• Negotiation performance: What the Sales Executive did well and could improve in the original meeting.
• Opportunity conversion: What the Sales Executive should do now to maximise the probability of signing the outstanding deal.
The first is reflected in the execution assessment. The second is handled through interactive follow-up coaching.
The AI must not retrospectively change the original execution score merely because later follow-up activity succeeds or fails.
14. Real TRC Case: Astana Hub, Kazakhstan
Context: Following a CEO interview for the Kazakhstan business special in USA Today, the Sales Executive sent a tailored follow-up email specifying the proposed participation and requesting a brief second meeting.
Actual follow-up email:
Dear Mr. Madiyev,
It was a pleasure to meet with you yesterday. Our team is already working on the transcription of the interview.
As agreed, I am sharing the details for your participation in our upcoming Kazakhstan business special in USA Today. Following our conversation, we propose a dedicated Corporate Profile on Astana Hub:
Print and digital eMag in USA Today: 1/4 Page – USD 15,000, including publication of the corporate profile, the full Q&A on our website and a podcast on our Spotify and Apple channels.
Please also see the attached USA Today media kit describing its readership and demographics.
Your transcription and a couple of visual layouts will be ready on Friday morning. Would you have 10 minutes for me at some point during the day before I fly back to Almaty to review the content of your interview?
Kind regards,
Sofia
What this example illustrates:
• A specific participation option and price rather than a generic proposal.
• Clear editorial and digital deliverables.
• A relevant media kit.
• A commitment to provide the transcript and visual layouts.
• A request for a brief second CEO meeting to review the interview content.
• A commercially purposeful follow-up that leads with the CEO's interview.
Coaching interpretation: This is an example of how to structure a tailored follow-up, not proof that the CEO signed or that the proposed terms were accepted. The actual commercial outcome must be established separately.
The AI should apply the underlying principles to comparable opportunities, not copy the email mechanically.
15. Operating Principles
The following principles govern TRC post-meeting conversion coaching:
1. Close on the spot whenever possible. Do not create a retorno unnecessarily.
2. Establish genuine CEO buy-in. Interest is not commitment.
3. Define the commercial position. Narrow the options and identify the actual decision path.
4. Move quickly. Follow up while the interview and negotiation remain fresh.
5. Lead with editorial value. Use the CEO's own messages as the strongest basis for continued engagement.
6. Keep the CEO appropriately involved. Avoid uncontrolled delegation without undermining marketing.
7. Use materials selectively. A polished transcript and one or two relevant visuals can be more effective than a generic presentation.
8. Make completion easy. Clarify terms, signatories and documentation; use a prepared contract where justified.
9. Adapt to the evidence. A strong retorno and a weak retorno require different actions.
10. Coach towards conversion. Every recommendation should help advance a real decision, not simply generate more follow-up activity.
16. Future TRC Case Examples
Additional real TRC follow-up cases may be incorporated into this document as they become available.
For each case, record:
• Company and project.
• Initial commercial position.
• CEO buy-in and preference evidence.
• Follow-up action taken.
• Relevant communication or dialogue.
• Actual commercial outcome, if known.
• Lessons supported by the case.
Examples are practical references, not universal rules. Their facts and outcomes must never be attributed to another negotiation.$playbook$)
ON CONFLICT (doc_key) DO UPDATE
    SET content = EXCLUDED.content
    WHERE public.sales_coach_knowledge.content = ''
       OR public.sales_coach_knowledge.content LIKE 'PLACEHOLDER%';
