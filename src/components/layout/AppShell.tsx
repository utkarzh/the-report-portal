"use client";

import Sidebar from './Sidebar'
import MobileTopBar from './MobileTopBar'
import FeedbackWidget from '@/components/feedback/FeedbackWidget'
import { FEEDBACK_WIDGET_ENABLED } from '@/lib/feedback'
import { useMobileDrawer } from '@/lib/use-mobile'
import type { UserRole } from '@/types'

interface Props {
  children: React.ReactNode;
  role: UserRole;
  tokenUsed: number;
  tokenLimit: number;
  userName: string | null;
  canAccessInterview: boolean;
  canAccessTranscriptions: boolean;
  canAccessBusinessCases: boolean;
  canAccessEditorialBriefs: boolean;
  canAccessMeetingPreparation: boolean;
  canAccessInterviewLetterGenerator: boolean;
  canAccessSalesNegotiationCoach: boolean;
  canAccessCopywritingTool: boolean;
  canAccessKnowledgeBase: boolean;
  canAccessFinance?: boolean;
  financeHref?: string;
}

export default function AppShell({
  children,
  role,
  tokenUsed,
  tokenLimit,
  userName,
  canAccessInterview,
  canAccessTranscriptions,
  canAccessBusinessCases,
  canAccessEditorialBriefs,
  canAccessMeetingPreparation,
  canAccessInterviewLetterGenerator,
  canAccessSalesNegotiationCoach,
  canAccessCopywritingTool,
  canAccessKnowledgeBase,
  canAccessFinance,
  financeHref,
}: Props) {
  const drawer = useMobileDrawer();

  // Below lg the document itself scrolls (so the browser's toolbars can collapse
  // and pull-to-refresh works) under a sticky top bar. From lg up it's the fixed
  // sidebar + independently scrolling main.
  return (
    <div className="flex min-h-dvh flex-col lg:h-screen lg:min-h-0 lg:flex-row lg:overflow-hidden">
      <MobileTopBar onOpenMenu={drawer.openDrawer} menuOpen={drawer.open} />

      {/* Backdrop — mobile only */}
      {drawer.open && (
        <div
          className="modal-backdrop-in fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={drawer.close}
        />
      )}

      <Sidebar
        role={role}
        tokenUsed={tokenUsed}
        tokenLimit={tokenLimit}
        userName={userName}
        canAccessInterview={canAccessInterview}
        canAccessTranscriptions={canAccessTranscriptions}
        canAccessBusinessCases={canAccessBusinessCases}
        canAccessEditorialBriefs={canAccessEditorialBriefs}
        canAccessMeetingPreparation={canAccessMeetingPreparation}
        canAccessInterviewLetterGenerator={canAccessInterviewLetterGenerator}
        canAccessSalesNegotiationCoach={canAccessSalesNegotiationCoach}
        canAccessCopywritingTool={canAccessCopywritingTool}
        canAccessKnowledgeBase={canAccessKnowledgeBase}
        canAccessFinance={canAccessFinance}
        financeHref={financeHref}
        mobileOpen={drawer.open}
        onMobileClose={drawer.close}
      />

      <main className="min-w-0 flex-1 overflow-x-clip bg-[#f0efec] lg:overflow-x-auto lg:overflow-y-auto">
        {children}
      </main>

      {FEEDBACK_WIDGET_ENABLED && <FeedbackWidget />}
    </div>
  );
}
