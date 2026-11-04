import { assign, setup } from '@dshfiles/plugin-ui/machine'

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
  | {
      readonly type: 'open'
      readonly sectionId?: string
      readonly field?: FieldTarget
      readonly target?: string
      readonly query?: string
    }
  | { readonly type: 'search'; readonly query: string }
  | { readonly type: 'close' }
  | { readonly type: 'back' }
  | { readonly type: 'select'; readonly sectionId: string }
  | { readonly type: 'focus'; readonly field: FieldTarget }
  | { readonly type: 'reveal'; readonly sectionId: string; readonly target: string }
  | { readonly type: 'panel.shown' }
  | { readonly type: 'panel.hidden' }

interface ShellContext {
  readonly ports: ShellPorts
  /** The selected nav section; undefined shows the first one. */
  readonly sectionId: string | undefined
  readonly field: FieldTarget | undefined
  /** The search entry id the selected section scrolls to, when it was opened from one. */
  readonly target: string | undefined
  /** The search field's text; non-empty replaces the section with matching settings. */
  readonly query: string
}

const focusRequested = assign<ShellContext, ShellEvent, undefined, ShellEvent, never>(({ event }) => {
  if (event.type !== 'focus') return {}
  return { sectionId: event.field.sectionId, field: event.field, target: undefined, query: '' }
})

const revealRequested = assign<ShellContext, ShellEvent, undefined, ShellEvent, never>(({ event }) => {
  if (event.type !== 'reveal') return {}
  return { sectionId: event.sectionId, field: undefined, target: event.target, query: '' }
})

const selectRequested = assign<ShellContext, ShellEvent, undefined, ShellEvent, never>(({ context, event }) => {
  if (event.type !== 'open') return {}
  const query = event.query ?? (event.field === undefined && event.sectionId === undefined ? context.query : '')
  if (event.field !== undefined) return { sectionId: event.field.sectionId, field: event.field, target: undefined, query }
  if (event.sectionId !== undefined && event.target !== undefined) return { sectionId: event.sectionId, field: undefined, target: event.target, query }
  return { sectionId: event.sectionId ?? context.sectionId, field: undefined, target: undefined, query }
})

/**
 * Settings visibility and section selection: the native shell's owner store (open, close, select, openSection) for the
 * one Settings page in the stage (plan `plans/ade-ux` §4.6). The Host's main view is the truth: showing the panel from
 * anywhere (a tab, a reload) opens Settings there, and leaving it closes Settings.
 */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const shellMachine = setup({
  types: { context: {} as ShellContext, events: {} as ShellEvent, input: {} as { readonly ports: ShellPorts } },
  actions: {
    showPanel: ({ context }) => context.ports.showPanel(),
    leavePanel: ({ context }) => context.ports.leavePanel(),
    selectRequested,
    focusRequested,
    revealRequested,
    // Hiding the main view closes the surface but keeps its query, so a tab switch restores the search; an explicit close clears it.
    forgetSection: assign({ sectionId: undefined, field: undefined, target: undefined }),
    forgetQuery: assign({ query: '' }),
    search: assign({ query: ({ event }) => (event.type === 'search' ? event.query : '') }),
  },
}).createMachine({
  id: 'settings-shell',
  context: ({ input }) => ({ ports: input.ports, sectionId: undefined, field: undefined, target: undefined, query: '' }),
  initial: 'closed',
  on: {
    select: { actions: assign({ sectionId: ({ event }) => event.sectionId, field: undefined, target: undefined, query: '' }) },
    back: { actions: ['forgetSection', 'forgetQuery'] },
    focus: { actions: 'focusRequested' },
    reveal: { actions: 'revealRequested' },
    search: { actions: 'search' },
  },
  states: {
    closed: {
      entry: 'forgetSection',
      on: {
        open: { target: 'tab', actions: ['selectRequested', 'showPanel'] },
        'panel.shown': { target: 'tab' },
      },
    },
    tab: {
      on: {
        // Settings already fills the stage: another open request only changes the section.
        open: { actions: ['selectRequested', 'showPanel'] },
        close: { target: 'closed', actions: ['leavePanel', 'forgetQuery'] },
        search: { actions: 'search' },
        'panel.hidden': { target: 'closed' },
      },
    },
  },
})
