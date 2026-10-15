import { assign, setup } from '@dshfiles/plugin-ui/machine'
import { PaletteRules } from './palette.js'
import type { PaletteMode } from './palette-api.js'

interface PaletteLocation {
  readonly mode: PaletteMode
  readonly query: string
}

interface PaletteNavigationInput {
  readonly mode: PaletteMode
}

interface PaletteNavigationContext {
  readonly mode: PaletteMode
  readonly query: string
  readonly backStack: readonly PaletteLocation[]
  readonly selected: string
  readonly notice: string | null
  readonly closeRequested: boolean
}

type PaletteNavigationEvent =
  | { readonly type: 'mode.sync'; readonly mode: PaletteMode }
  | { readonly type: 'mode.change'; readonly mode: PaletteMode }
  | { readonly type: 'query.change'; readonly query: string }
  | { readonly type: 'selection.change'; readonly value: string }
  | { readonly type: 'files.navigate' }
  | { readonly type: 'notice.show'; readonly message: string }
  | { readonly type: 'notice.clear' }
  | { readonly type: 'back' }
  | { readonly type: 'close.handled' }

// SAFETY: XState uses these empty carriers for inference; runtime values come from the input and typed events.
export const paletteNavigationMachine = setup({
  types: {
    input: {} as PaletteNavigationInput,
    context: {} as PaletteNavigationContext,
    events: {} as PaletteNavigationEvent,
  },
  actions: {
    syncMode: assign(({ event }) =>
      event.type === 'mode.sync' ? { mode: event.mode, query: '', backStack: [], selected: '', notice: null, closeRequested: false } : {},
    ),
    changeMode: assign(({ event }) => (event.type === 'mode.change' ? { mode: event.mode, selected: '', notice: null } : {})),
    changeQuery: assign(({ event }) => (event.type === 'query.change' ? { query: event.query, selected: '', notice: null } : {})),
    changeSelection: assign(({ event }) => (event.type === 'selection.change' ? { selected: event.value } : {})),
    navigateToFiles: assign(({ context }) => ({
      backStack: [...context.backStack, { mode: context.mode, query: context.query }],
      mode: 'files' as const,
      query: '',
      selected: '',
      notice: null,
      closeRequested: false,
    })),
    showNotice: assign(({ event }) => (event.type === 'notice.show' ? { notice: event.message } : {})),
    clearNotice: assign(() => ({ notice: null })),
    goBack: assign(({ context }) => {
      const parsed = PaletteRules.parsePaletteQuery(context.query)
      if (parsed.prefix !== null) return { query: parsed.text, selected: '', notice: null, closeRequested: false }
      const previous = context.backStack.at(-1)
      if (previous !== undefined) {
        return {
          backStack: context.backStack.slice(0, -1),
          mode: previous.mode,
          query: previous.query,
          selected: '',
          notice: null,
          closeRequested: false,
        }
      }
      if (context.query.length > 0) return { query: '', selected: '', notice: null, closeRequested: false }
      return { closeRequested: true }
    }),
    markCloseHandled: assign(() => ({ closeRequested: false })),
  },
}).createMachine({
  id: 'paletteNavigation',
  context: ({ input }) => ({
    mode: input.mode,
    query: '',
    backStack: [],
    selected: '',
    notice: null,
    closeRequested: false,
  }),
  initial: 'active',
  states: {
    active: {
      on: {
        'mode.sync': { actions: 'syncMode' },
        'mode.change': { actions: 'changeMode' },
        'query.change': { actions: 'changeQuery' },
        'selection.change': { actions: 'changeSelection' },
        'files.navigate': { actions: 'navigateToFiles' },
        'notice.show': { actions: 'showNotice' },
        'notice.clear': { actions: 'clearNotice' },
        back: { actions: 'goBack' },
        'close.handled': { actions: 'markCloseHandled' },
      },
    },
  },
})
