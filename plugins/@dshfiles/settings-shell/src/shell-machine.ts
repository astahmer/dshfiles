import { assign, setup } from '@dshfiles/plugin-ui/machine'

export type ShellEvent =
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | { readonly type: 'select'; readonly sectionId: string }
  | { readonly type: 'openSection'; readonly sectionId: string }

interface ShellContext {
  /** The selected nav section; undefined shows the first one. */
  readonly sectionId: string | undefined
}

/** Settings visibility and section selection, the port of the native shell's owner store. */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const shellMachine = setup({
  types: { context: {} as ShellContext, events: {} as ShellEvent },
}).createMachine({
  id: 'settings-shell',
  context: { sectionId: undefined },
  initial: 'closed',
  states: {
    closed: {
      on: {
        open: { target: 'open' },
        openSection: { target: 'open', actions: assign({ sectionId: ({ event }) => event.sectionId }) },
      },
    },
    open: {
      on: {
        close: { target: 'closed', actions: assign({ sectionId: undefined }) },
        select: { actions: assign({ sectionId: ({ event }) => event.sectionId }) },
        openSection: { actions: assign({ sectionId: ({ event }) => event.sectionId }) },
      },
    },
  },
})
