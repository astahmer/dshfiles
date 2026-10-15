import { assign, emit, setup } from '@dshfiles/plugin-ui/machine'

interface AutoRefreshContext {
  readonly pageVisible: boolean
  readonly intersecting: boolean
  readonly laidOut: boolean
}

type AutoRefreshEvent =
  | { readonly type: 'document.visibility'; readonly visible: boolean }
  | { readonly type: 'element.intersection'; readonly intersecting: boolean }
  | { readonly type: 'element.layout'; readonly laidOut: boolean }

type AutoRefreshInput = { readonly pageVisible: boolean }
type NextVisibility = Partial<Pick<AutoRefreshContext, 'pageVisible' | 'intersecting' | 'laidOut'>>

const isVisible = (context: AutoRefreshContext): boolean => context.pageVisible && context.intersecting && context.laidOut

const becomesVisible = (context: AutoRefreshContext, next: NextVisibility): boolean =>
  !isVisible(context) &&
  isVisible({
    pageVisible: next.pageVisible ?? context.pageVisible,
    intersecting: next.intersecting ?? context.intersecting,
    laidOut: next.laidOut ?? context.laidOut,
  })

// SAFETY: XState uses these empty carriers only for compile-time inference; runtime behavior comes from the typed machine.
export const autoRefreshVisibilityMachine = setup({
  types: {
    context: {} as AutoRefreshContext,
    events: {} as AutoRefreshEvent,
    input: {} as AutoRefreshInput,
    emitted: {} as { readonly type: 'becameVisible' },
  },
  guards: {
    becameVisibleOnDocument: ({ context, event }) => event.type === 'document.visibility' && becomesVisible(context, { pageVisible: event.visible }),
    becameVisibleOnIntersection: ({ context, event }) => event.type === 'element.intersection' && becomesVisible(context, { intersecting: event.intersecting }),
    becameVisibleOnLayout: ({ context, event }) => event.type === 'element.layout' && becomesVisible(context, { laidOut: event.laidOut }),
  },
  actions: {
    setPageVisibility: assign(({ event }) => (event.type === 'document.visibility' ? { pageVisible: event.visible } : {})),
    setIntersection: assign(({ event }) => (event.type === 'element.intersection' ? { intersecting: event.intersecting } : {})),
    setLayout: assign(({ event }) => (event.type === 'element.layout' ? { laidOut: event.laidOut } : {})),
  },
}).createMachine({
  id: 'autoRefreshVisibility',
  initial: 'tracking',
  context: ({ input }) => ({ pageVisible: input.pageVisible, intersecting: true, laidOut: true }),
  states: {
    tracking: {
      on: {
        'document.visibility': [
          { guard: 'becameVisibleOnDocument', actions: ['setPageVisibility', emit({ type: 'becameVisible' })] },
          { actions: 'setPageVisibility' },
        ],
        'element.intersection': [
          { guard: 'becameVisibleOnIntersection', actions: ['setIntersection', emit({ type: 'becameVisible' })] },
          { actions: 'setIntersection' },
        ],
        'element.layout': [{ guard: 'becameVisibleOnLayout', actions: ['setLayout', emit({ type: 'becameVisible' })] }, { actions: 'setLayout' }],
      },
    },
  },
})
