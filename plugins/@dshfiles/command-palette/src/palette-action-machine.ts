import { assign, emit, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { PaletteAction, PaletteActionContext } from './palette-contract.js'

interface PaletteActionRequest {
  readonly action: PaletteAction
  readonly context: PaletteActionContext
}

interface PaletteActionMachineContext {
  readonly request: PaletteActionRequest | null
}

type PaletteActionMachineEvent = { readonly type: 'run'; readonly action: PaletteAction; readonly context: PaletteActionContext } | { readonly type: 'reset' }

const runPaletteAction = fromPromise<void, { readonly request: PaletteActionRequest | null }>(async ({ input }) => {
  if (input.request === null) throw new Error('The command palette action request is missing.')
  await input.request.action.run(input.request.context)
})

// SAFETY: XState uses these empty carriers for inference; runtime context and events are established by machine transitions.
export const paletteActionMachine = setup({
  types: {
    context: {} as PaletteActionMachineContext,
    events: {} as PaletteActionMachineEvent,
  },
  actors: { runPaletteAction },
  actions: {
    captureRequest: assign(({ event }) => (event.type === 'run' ? { request: { action: event.action, context: event.context } } : {})),
    clearRequest: assign({ request: null }),
  },
}).createMachine({
  id: 'paletteAction',
  initial: 'idle',
  context: { request: null },
  on: {
    reset: { target: '#paletteAction.idle', actions: 'clearRequest' },
  },
  states: {
    idle: { on: { run: { target: 'running', actions: 'captureRequest' } } },
    running: {
      invoke: {
        src: 'runPaletteAction',
        input: ({ context }) => ({ request: context.request }),
        onDone: {
          target: 'succeeded',
          actions: [emit({ type: 'completed' }), 'clearRequest'],
        },
        onError: { target: 'failed', actions: 'clearRequest' },
      },
    },
    failed: { on: { run: { target: 'running', actions: 'captureRequest' } } },
    succeeded: { type: 'final' },
  },
})
