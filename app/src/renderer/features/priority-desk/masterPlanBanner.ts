// Pure copy generation for the Master Plan diagnostic banner — kept out of
// the .tsx component so it can be unit-tested without React (mirrors
// project-board/focus.ts's split from FocusRankRepairBanner.tsx).
import type { MasterPlanState } from '../../../shared/masterPlan';

export interface MasterPlanBannerCopy {
  title: string;
  text: string;
}

const STILL_WORKS =
  'Epic filtering and the rest of Priority Desk still work; Master Plan outcome context ' +
  'is unavailable until this is resolved.';

// Returns null for states that are not diagnostics: 'none' is a supported
// empty state (no Master Plan article configured yet), and a 'loaded'
// article with no parse diagnostics is simply working correctly. Every
// other state gets a banner rather than only a console warning — a
// duplicate article, a failed/incomplete discovery, or malformed/partial
// content are all things Kevin needs to see, not just log (VERM-7 review
// correction, 2026-09-16).
export function masterPlanBannerCopy(state: MasterPlanState): MasterPlanBannerCopy | null {
  switch (state.kind) {
    case 'none':
      return null;
    case 'ambiguous-articles':
      return {
        title: 'Multiple Master Plan articles found',
        text:
          `YouTrack has ${state.articleIds.length} articles named _vermilian-master-plan in ` +
          `the VERM project — Vermilian will not guess which one is current. ${STILL_WORKS}`,
      };
    case 'discovery-error':
      return {
        title: "Couldn't load the Master Plan article",
        text: `A request to YouTrack for the Master Plan article failed. ${STILL_WORKS}`,
      };
    case 'discovery-incomplete':
      return {
        title: "Couldn't confirm the Master Plan article",
        text: `Master Plan article discovery could not be completed against YouTrack. ${STILL_WORKS}`,
      };
    case 'loaded': {
      if (state.parseStatus === 'valid' && state.diagnostics.length === 0) return null;
      const detail = state.diagnostics.map((d) => d.message).join(' ');
      return {
        title:
          state.parseStatus === 'unusable'
            ? 'Master Plan article could not be read'
            : 'Some Master Plan content could not be used',
        text: `${detail} ${STILL_WORKS}`,
      };
    }
    default:
      return null;
  }
}
