import { assign, emit, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { PaletteAction, PaletteActionContext } from './palette-contract.js'

interface PaletteActionRequest {
  readonly action: PaletteAction
  readonly context: PaletteActionContext
}

export interface PaletteActionMachineInput {
  /** Send one Ask DSH question and resolve once it was accepted; the machine keeps the palette pending meanwhile. */
  readonly ask: (question: string) => Promise<void>
}

interface PaletteActionMachineContext extends PaletteActionMachineInput {
  readonly request: PaletteActionRequest | null
  readonly question: string | null
}

type PaletteActionMachineEvent =
  | { readonly type: 'run'; readonly action: PaletteAction; readonly context: PaletteActionContext }
  | { readonly type: 'ask'; readonly question: string }
  | { readonly type: 'reset' }

const runPaletteAction = fromPromise<void, { readonly request: PaletteActionRequest | null }>(async ({ input }) => {
  if (input.request === null) throw new Error('The command palette action request is missing.')
  await input.request.action.run(input.request.context)
})

const askDsh = fromPromise<void, { readonly ask: PaletteActionMachineInput['ask']; readonly question: string | null }>(async ({ input }) => {
  if (input.question === null) throw new Error('The Ask DSH question is missing.')
  await input.ask(input.question)
})

// SAFETY: XState uses these empty carriers for inference; runtime context and events are established by machine transitions.
export const paletteActionMachine = setup({
  types: {
    input: {} as PaletteActionMachineInput,
    context: {} as PaletteActionMachineContext,
    events: {} as PaletteActionMachineEvent,
  },
  actors: { runPaletteAction, askDsh },
  actions: {
    captureRequest: assign(({ event }) => (event.type === 'run' ? { request: { action: event.action, context: event.context } } : {})),
    captureQuestion: assign(({ event }) => (event.type === 'ask' ? { question: event.question } : {})),
    clearRequest: assign({ request: null }),
    clearQuestion: assign({ question: null }),
  },
}).createMachine({
  id: 'paletteAction',
  initial: 'idle',
  context: ({ input }) => ({ ask: input.ask, request: null, question: null }),
  on: {
    reset: { target: '#paletteAction.idle', actions: ['clearRequest', 'clearQuestion'] },
  },
  states: {
    idle: {
      on: {
        run: { target: 'running', actions: 'captureRequest' },
        ask: { target: 'asking', actions: 'captureQuestion' },
      },
    },
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
    asking: {
      invoke: {
        src: 'askDsh',
        input: ({ context }) => ({ ask: context.ask, question: context.question }),
        onDone: {
          target: 'succeeded',
          actions: [emit({ type: 'completed' }), 'clearQuestion'],
        },
        onError: { target: 'idle', actions: [emit({ type: 'askFailed' }), 'clearQuestion'] },
      },
    },
    failed: {
      on: {
        run: { target: 'running', actions: 'captureRequest' },
        ask: { target: 'asking', actions: 'captureQuestion' },
      },
    },
    succeeded: { type: 'final' },
  },
})
