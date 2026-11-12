import type { SidebarSectionHookContext, SidebarSectionInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ChildrenDecl } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@dshfiles/frame-layout/regions'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Preview contributions rendered by the regular Workbench preview assembly, with a fixed standalone-sidebar fallback.
     * Declared by this sidebar only; the stock sidebar has no such seat, so occupants keep a footer-action fallback.
     */
    'sidebar.footer.above': {
      kind: 'list'
      scope: 'root'
      owner: Record<never, never>
    }
  }
}

/** The section occupant receives the scroller hook from each render's hookContext, as the stock sidebar declares it. */
const SIDEBAR_SECTION_INJECT: SidebarSectionInjected = {
  hooks: { sectionScroller: (_standard, { useSectionScroller }) => useSectionScroller },
}

const UNBOUND_SECTION_SCROLLER = { bindScrollerRef: () => {} }

/** This sidebar keeps native scrolling: no wheel hand-off between its viewport and the section's own scroller. */
export const sidebarSectionHookContext: SidebarSectionHookContext = {
  useSectionScroller: () => UNBOUND_SECTION_SCROLLER,
}

export const sidebarChildren = {
  'shell.left': { kind: 'single', scope: 'root' },
  'sidebar.brand.mark': { kind: 'single', scope: 'root' },
  'sidebar.brand.name': { kind: 'single', scope: 'root' },
  'sidebar.toggle.badge': { kind: 'single', scope: 'root' },
  'sidebar.panellist': { kind: 'list', scope: 'root' },
  'sidebar.workspaces': { kind: 'single', scope: 'root', inject: SIDEBAR_SECTION_INJECT },
  'sidebar.settings': { kind: 'single', scope: 'root' },
  'sidebar.footer.action': { kind: 'list', scope: 'root' },
  'sidebar.footer.above': { kind: 'list', scope: 'root' },
} satisfies ChildrenDecl
