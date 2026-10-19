import { assign, fromCallback, setup } from '@dshfiles/plugin-ui/machine'

export interface AccountRemovalTarget {
  readonly instanceId: string
  readonly displayName: string
}

export type AccountRemovalPort = (target: AccountRemovalTarget) => Promise<void>

interface AccountRemovalInput {
  readonly removeAccount: AccountRemovalPort
}

interface AccountRemovalContext extends AccountRemovalInput {
  readonly operationId: number
  readonly target: AccountRemovalTarget | null
}

interface RemoveActorInput {
  readonly operationId: number
  readonly removeAccount: AccountRemovalPort
  readonly target: AccountRemovalTarget | null
}

type AccountRemovalEvent =
  | { readonly type: 'request'; readonly target: AccountRemovalTarget }
  | { readonly type: 'confirm' }
  | { readonly type: 'cancel' }
  | { readonly type: 'retry' }
  | { readonly type: 'remove.completed'; readonly operationId: number }
  | { readonly type: 'remove.failed'; readonly operationId: number }

// SAFETY: XState uses empty carriers for inference; runtime input and events are typed above.
export const accountRemoveMachine = setup({
  types: {
    context: {} as AccountRemovalContext,
    events: {} as AccountRemovalEvent,
    input: {} as AccountRemovalInput,
  },
  actors: {
    removeAccount: fromCallback<AccountRemovalEvent, RemoveActorInput>(({ input, sendBack }) => {
      let active = true
      const target = input.target

      if (target === null) {
        sendBack({ type: 'remove.failed', operationId: input.operationId })
        return () => {
          active = false
        }
      }

      void Promise.resolve()
        .then(() => input.removeAccount(target))
        .then(
          () => {
            if (active) sendBack({ type: 'remove.completed', operationId: input.operationId })
          },
          () => {
            if (active) sendBack({ type: 'remove.failed', operationId: input.operationId })
          },
        )

      return () => {
        active = false
      }
    }),
  },
  guards: {
    currentOperation: ({ context, event }) =>
      (event.type === 'remove.completed' || event.type === 'remove.failed') && event.operationId === context.operationId,
  },
  actions: {
    captureTarget: assign(({ context, event }) => (event.type === 'request' ? { operationId: context.operationId + 1, target: event.target } : {})),
    invalidateTarget: assign(({ context }) => ({ operationId: context.operationId + 1, target: null })),
    retryOperation: assign(({ context }) => ({ operationId: context.operationId + 1 })),
  },
}).createMachine({
  id: 'accountRemove',
  initial: 'idle',
  context: ({ input }) => ({ operationId: 0, removeAccount: input.removeAccount, target: null }),
  states: {
    idle: {
      on: {
        request: { target: 'confirming', actions: 'captureTarget' },
      },
    },
    confirming: {
      on: {
        cancel: { target: 'idle', actions: 'invalidateTarget' },
        confirm: { target: 'removing' },
      },
    },
    removing: {
      invoke: {
        src: 'removeAccount',
        input: ({ context }) => ({ operationId: context.operationId, removeAccount: context.removeAccount, target: context.target }),
      },
      on: {
        'remove.completed': { guard: 'currentOperation', target: 'removed' },
        'remove.failed': { guard: 'currentOperation', target: 'error' },
      },
    },
    error: {
      on: {
        cancel: { target: 'idle', actions: 'invalidateTarget' },
        retry: { target: 'removing', actions: 'retryOperation' },
      },
    },
    removed: {},
  },
})
