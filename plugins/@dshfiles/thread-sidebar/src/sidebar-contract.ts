import type { ChildrenDecl } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Full-width rows stacked above the wide sidebar foot (a usage strip, a status line). Declared by this sidebar
     * only; the stock sidebar has no such seat, so occupants keep a footer-action fallback.
     */
    'sidebar.footer.above': {
      kind: 'list'
      scope: 'root'
      owner: Record<never, never>
    }
  }
}

export const sidebarChildren = {
  'sidebar.brand.mark': { kind: 'single', scope: 'root' },
  'sidebar.brand.name': { kind: 'single', scope: 'root' },
  'sidebar.toggle.badge': { kind: 'single', scope: 'root' },
  'sidebar.panellist': { kind: 'list', scope: 'root' },
  'sidebar.workspaces': { kind: 'single', scope: 'root' },
  'sidebar.settings': { kind: 'single', scope: 'root' },
  'sidebar.footer.action': { kind: 'list', scope: 'root' },
  'sidebar.footer.above': { kind: 'list', scope: 'root' },
} satisfies ChildrenDecl
