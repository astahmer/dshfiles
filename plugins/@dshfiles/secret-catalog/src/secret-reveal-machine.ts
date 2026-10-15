import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { ApiClient, ApiClientInput } from '@dshfiles/dshx/api'
import { secretCatalogApi } from './api.js'

export type SecretRevealClient = Pick<ApiClient<typeof secretCatalogApi.methods>, 'reveal'>
export type SecretRevealRequest = ApiClientInput<typeof secretCatalogApi.methods.reveal>

interface SecretRevealRequestState {
  readonly rowId: string
  readonly payload: SecretRevealRequest
}

interface SecretRevealContext {
  readonly operationId: number
  readonly request: SecretRevealRequestState | null
  readonly revealMs: number
  readonly revealed: { readonly rowId: string; readonly value: string } | null
}

interface SecretRevealEvent {
  readonly type: 'toggle'
  readonly rowId: string
  readonly payload: SecretRevealRequest
  readonly revealMs: number
}

interface SecretRevealHideEvent {
  readonly type: 'hide'
}

type SecretRevealMachineEvent = SecretRevealEvent | SecretRevealHideEvent

type SecretRevealResult =
  | { readonly operationId: number; readonly status: 'revealed'; readonly rowId: string; readonly value: string }
  | { readonly operationId: number; readonly status: 'failed' }

interface SecretRevealActorInput {
  readonly operationId: number
  readonly request: SecretRevealRequestState
}

export const createSecretRevealActor = (client: SecretRevealClient) =>
  fromPromise<SecretRevealResult, SecretRevealActorInput>(async ({ input, signal }) => {
    try {
      const value = await client.reveal(input.request.payload, { signal })
      return { operationId: input.operationId, status: 'revealed', rowId: input.request.rowId, value }
    } catch {
      return { operationId: input.operationId, status: 'failed' }
    }
  })

// SAFETY: XState uses these empty carriers for inference; nothing reads their values.
export const secretRevealMachine = setup({
  types: {
    context: {} as SecretRevealContext,
    events: {} as SecretRevealMachineEvent,
  },
  actors: {
    revealSecret: fromPromise<SecretRevealResult, SecretRevealActorInput>(() => {
      throw new Error('Secret reveal machine requires an injected actor.')
    }),
  },
  delays: {
    revealTimeout: ({ context }) => context.revealMs,
  },
  guards: {
    samePendingRow: ({ context, event }) => event.type === 'toggle' && context.request?.rowId === event.rowId,
    sameRevealedRow: ({ context, event }) => event.type === 'toggle' && context.revealed?.rowId === event.rowId,
  },
  actions: {
    beginReveal: assign(({ context, event }) =>
      event.type === 'toggle'
        ? {
            operationId: context.operationId + 1,
            request: { rowId: event.rowId, payload: event.payload },
            revealMs: Math.max(0, event.revealMs),
            revealed: null,
          }
        : {},
    ),
    clear: assign(({ context }) => ({ operationId: context.operationId + 1, request: null, revealed: null })),
    clearRequest: assign({ request: null }),
  },
}).createMachine({
  id: 'secretReveal',
  initial: 'idle',
  context: { operationId: 0, request: null, revealMs: 0, revealed: null },
  states: {
    idle: {
      on: { toggle: { target: 'loading', actions: 'beginReveal' } },
    },
    loading: {
      invoke: {
        src: 'revealSecret',
        input: ({ context }) => {
          if (context.request === null) throw new Error('Secret reveal request is missing.')
          return { operationId: context.operationId, request: context.request }
        },
        onDone: [
          {
            guard: ({ context, event }) => event.output.operationId === context.operationId && event.output.status === 'revealed',
            target: 'visible',
            actions: assign(({ event }) => {
              const result = event.output
              if (result.status !== 'revealed') return {}
              return { request: null, revealed: { rowId: result.rowId, value: result.value } }
            }),
          },
          {
            guard: ({ context, event }) => event.output.operationId === context.operationId,
            target: 'failed',
            actions: 'clearRequest',
          },
          { target: 'idle', actions: 'clear' },
        ],
        onError: { target: 'failed', actions: 'clearRequest' },
      },
      on: {
        toggle: [
          { guard: 'samePendingRow', target: 'idle', actions: 'clear' },
          { target: 'loading', reenter: true, actions: 'beginReveal' },
        ],
        hide: { target: 'idle', actions: 'clear' },
      },
    },
    visible: {
      after: { revealTimeout: { target: 'idle', actions: 'clear' } },
      on: {
        toggle: [
          { guard: 'sameRevealedRow', target: 'idle', actions: 'clear' },
          { target: 'loading', actions: 'beginReveal' },
        ],
        hide: { target: 'idle', actions: 'clear' },
      },
    },
    failed: {
      on: {
        toggle: { target: 'loading', actions: 'beginReveal' },
        hide: { target: 'idle', actions: 'clear' },
      },
    },
  },
})
