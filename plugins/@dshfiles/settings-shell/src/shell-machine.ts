import { assign, setup } from '@dshfiles/plugin-ui/machine'

/** Where Settings shows: a dialog over the current view, that dialog filling the window, or the main view (a tab). */
export type ShellSurface = 'modal' | 'tab'

interface ShellPorts {
  /** Show the Settings main panel; main-tabs, when loaded, gives it a tab. */
  readonly showPanel: () => void
  /** Leave the Settings main panel for whatever the main view showed before. */
  readonly leavePanel: () => void
}

/** A settings field to scroll to and flash once its page shows. */
export interface FieldTarget {
  readonly sectionId: string
  readonly fieldPath: readonly string[]
}

type ShellEvent =
  | { readonly type: 'open'; readonly surface: ShellSurface; readonly sectionId?: string; readonly field?: FieldTarget; readonly query?: string }
  | { readonly type: 'search'; readonly query: string }
  | { readonly type: 'close' }
  | { readonly type: 'select'; readonly sectionId: string }
  | { readonly type: 'expand' }
  | { readonly type: 'restore' }
  | { readonly type: 'moveToTab' }
  | { readonly type: 'panel.shown' }
  | { readonly type: 'panel.hidden' }

interface ShellContext {
  readonly ports: ShellPorts
  /** The selected nav section; undefined shows the first one. */
  readonly sectionId: string | undefined
  readonly field: FieldTarget | undefined
  /** The search field's text; non-empty replaces the section with matching settings. */
  readonly query: string
}

const selectRequested = assign<ShellContext, ShellEvent, undefined, ShellEvent, never>(({ context, event }) => {
  if (event.type !== 'open') return {}
  const query = event.query ?? (event.field === undefined && event.sectionId === undefined ? context.query : '')
  if (event.field !== undefined) return { sectionId: event.field.sectionId, field: event.field, query }
  return { sectionId: event.sectionId ?? context.sectionId, field: undefined, query }
})

/**
 * Settings visibility, surface and section selection: the native shell's owner store (open, close, select,
 * openSection) plus the expanded dialog and the main-view tab. The Host's main view is the truth for the tab: showing
 * the panel from anywhere (a tab, a reload) opens Settings there, and leaving it closes Settings.
 */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const shellMachine = setup({
  types: { context: {} as ShellContext, events: {} as ShellEvent, input: {} as { readonly ports: ShellPorts } },
  actions: {
    showPanel: ({ context }) => context.ports.showPanel(),
    leavePanel: ({ context }) => context.ports.leavePanel(),
    selectRequested,
    forgetSection: assign({ sectionId: undefined, field: undefined, query: '' }),
    search: assign({ query: ({ event }) => (event.type === 'search' ? event.query : '') }),
  },
  guards: {
    wantsTab: ({ event }) => event.type === 'open' && event.surface === 'tab',
  },
}).createMachine({
  id: 'settings-shell',
  context: ({ input }) => ({ ports: input.ports, sectionId: undefined, field: undefined, query: '' }),
  initial: 'closed',
  on: {
    select: { actions: assign({ sectionId: ({ event }) => event.sectionId, field: undefined, query: '' }) },
  },
  states: {
    closed: {
      entry: 'forgetSection',
      on: {
        open: [
          { guard: 'wantsTab', target: 'tab', actions: ['selectRequested', 'showPanel'] },
          { target: 'modal', actions: 'selectRequested' },
        ],
        'panel.shown': { target: 'tab' },
      },
    },
    modal: {
      initial: 'normal',
      states: {
        normal: { on: { expand: { target: 'expanded' } } },
        expanded: { on: { restore: { target: 'normal' } } },
      },
      on: {
        open: [{ guard: 'wantsTab', target: 'tab', actions: ['selectRequested', 'showPanel'] }, { actions: 'selectRequested' }],
        close: { target: 'closed' },
        search: { actions: 'search' },
        moveToTab: { target: 'tab', actions: 'showPanel' },
        'panel.shown': { target: 'tab' },
      },
    },
    tab: {
      on: {
        // Settings already fills the main view: a request for the dialog only changes the section.
        open: { actions: ['selectRequested', 'showPanel'] },
        close: { target: 'closed', actions: 'leavePanel' },
        search: { actions: 'search' },
        'panel.hidden': { target: 'closed' },
      },
    },
  },
})
