import { supabaseAdmin } from '@/lib/supabase/admin'
import { locateClaimInDraft } from '@/lib/copywriting'

// Recomputes each Research Ledger entry's "position in the draft"
// (copywriting_research_entries.placement). Called whenever the draft text or
// a finding's approval status changes. Only approved findings are fed to the
// writer, so only they get a position; everything else is cleared. Best
// effort: a failure here must never fail the draft/revision/approval that
// triggered it.
export async function refreshResearchPlacements(projectId: string, draftText: string | null | undefined) {
  try {
    const { data: entries } = await supabaseAdmin
      .from('copywriting_research_entries')
      .select('id, claim, status, placement')
      .eq('project_id', projectId)
    for (const e of entries || []) {
      const placement = e.status === 'approved' && draftText ? locateClaimInDraft(e.claim, draftText) : null
      if (placement !== e.placement) {
        await supabaseAdmin.from('copywriting_research_entries').update({ placement }).eq('id', e.id)
      }
    }
  } catch (err) {
    console.error('[copywriting] refreshResearchPlacements failed:', err)
  }
}
