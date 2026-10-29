import { assign, emit, setup } from '@dshfiles/plugin-ui/machine'

interface AutoRefreshContext {
  readonly pageVisible: boolean
  /** The surface hosting the panel shows it; a dock tab behind another stays mounted, laid out and intersecting. */
  readonly surfaceVisible: boolean
  readonly intersecting: boolean
  readonly laidOut: boolean
}

type AutoRefreshEvent =
  | { readonly type: 'document.visibility'; readonly visible: boolean }
  | { readonly type: 'element.intersection'; readonly intersecting: boolean }
  | { readonly type: 'element.layout'; readonly laidOut: boolean }
  | { readonly type: 'surface.visibility'; readonly visible: boolean }

type AutoRefreshInput = { readonly pageVisible: boolean; readonly surfaceVisible: boolean }
type NextVisibility = Partial<AutoRefreshContext>

const isVisible = (context: AutoRefreshContext): boolean => context.pageVisible && context.surfaceVisible && context.intersecting && context.laidOut

const becomesVisible = (context: AutoRefreshContext, next: NextVisibility): boolean => !isVisible(context) && isVisible({ ...context, ...next })

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
    becameVisibleOnSurface: ({ context, event }) => event.type === 'surface.visibility' && becomesVisible(context, { surfaceVisible: event.visible }),
  },
  actions: {
    setPageVisibility: assign(({ event }) => (event.type === 'document.visibility' ? { pageVisible: event.visible } : {})),
    setIntersection: assign(({ event }) => (event.type === 'element.intersection' ? { intersecting: event.intersecting } : {})),
    setLayout: assign(({ event }) => (event.type === 'element.layout' ? { laidOut: event.laidOut } : {})),
    setSurfaceVisibility: assign(({ event }) => (event.type === 'surface.visibility' ? { surfaceVisible: event.visible } : {})),
  },
}).createMachine({
  id: 'autoRefreshVisibility',
  initial: 'tracking',
  context: ({ input }) => ({ pageVisible: input.pageVisible, surfaceVisible: input.surfaceVisible, intersecting: true, laidOut: true }),
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
        'surface.visibility': [
          { guard: 'becameVisibleOnSurface', actions: ['setSurfaceVisibility', emit({ type: 'becameVisible' })] },
          { actions: 'setSurfaceVisibility' },
        ],
      },
    },
  },
})
