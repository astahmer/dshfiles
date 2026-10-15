import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'

export interface WelcomeNoticeScopeState {
  readonly mode: 'host' | 'memory'
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly acknowledged: boolean
}

interface PersistInput {
  readonly write: () => Promise<boolean>
}

interface WelcomeNoticeContext extends PersistInput {
  readonly scope: WelcomeNoticeScopeState
  readonly acknowledged: boolean
  readonly localAcknowledged: boolean
  readonly error: string | null
}

interface WelcomeNoticeInput extends PersistInput {
  readonly scope: WelcomeNoticeScopeState
}

type WelcomeNoticeEvent =
  | { readonly type: 'scope.changed'; readonly scope: WelcomeNoticeScopeState }
  | { readonly type: 'acknowledge' }

const unavailableMessage = 'welcome acknowledgement settings are unavailable'
const persistenceMessage = 'the acknowledgement did not persist'

const scopeForEvent = (event: WelcomeNoticeEvent) => event.type === 'scope.changed' ? event.scope : undefined

export const welcomeNoticeMachine = setup({
  // SAFETY: XState uses these empty carriers for inference; the runtime reads the actual machine input and events.
  types: {
    context: {} as WelcomeNoticeContext,
    events: {} as WelcomeNoticeEvent,
    input: {} as WelcomeNoticeInput,
  },
  actors: {
    persistAcknowledgement: fromPromise<boolean, PersistInput>(() => {
      throw new Error('settings-shell must provide the welcome acknowledgement writer')
    }),
  },
  guards: {
    isMemory: ({ context }) => context.scope.mode === 'memory',
    isLoading: ({ context }) => context.scope.mode !== 'memory' && context.scope.status === 'loading',
    isUnavailable: ({ context }) => context.scope.mode !== 'memory' && context.scope.status === 'unavailable',
    isMemoryUpdate: ({ event }) => scopeForEvent(event)?.mode === 'memory',
    isLoadingUpdate: ({ event }) => {
      const scope = scopeForEvent(event)
      return scope !== undefined && scope.mode !== 'memory' && scope.status === 'loading'
    },
    isUnavailableUpdate: ({ event }) => {
      const scope = scopeForEvent(event)
      return scope !== undefined && scope.mode !== 'memory' && scope.status === 'unavailable'
    },
    persistenceAccepted: ({ event }) => 'output' in event && event.output === true,
    scopeAlreadyAcknowledged: ({ context }) => context.scope.mode === 'host' && context.scope.acknowledged,
  },
  actions: {
    updateScope: assign(({ context, event }) => {
      if (event.type !== 'scope.changed') return {}
      const scope = event.scope
      return {
        scope,
        acknowledged: scope.mode === 'memory' ? context.localAcknowledged : scope.acknowledged,
        error: scope.mode !== 'memory' && scope.status === 'unavailable' ? unavailableMessage : null,
      }
    }),
    markLocalAcknowledged: assign({ localAcknowledged: true, acknowledged: true, error: null }),
    clearError: assign({ error: null }),
    markAcknowledged: assign({ acknowledged: true, error: null }),
    markUnavailable: assign({ acknowledged: false, error: unavailableMessage }),
    markPersistenceFailure: assign({ acknowledged: false, error: persistenceMessage }),
  },
}).createMachine({
  id: 'welcomeNotice',
  initial: 'sync',
  context: ({ input }) => ({
    scope: input.scope,
    write: input.write,
    acknowledged: input.scope.mode === 'memory' ? false : input.scope.acknowledged,
    localAcknowledged: false,
    error: input.scope.mode !== 'memory' && input.scope.status === 'unavailable' ? unavailableMessage : null,
  }),
  on: {
    'scope.changed': [
      { guard: 'isMemoryUpdate', target: '#welcomeNotice.ready', actions: 'updateScope' },
      { guard: 'isLoadingUpdate', target: '#welcomeNotice.loading', actions: 'updateScope' },
      { guard: 'isUnavailableUpdate', target: '#welcomeNotice.error', actions: 'updateScope' },
      { target: '#welcomeNotice.ready', actions: 'updateScope' },
    ],
  },
  states: {
    sync: {
      always: [
        { guard: 'isMemory', target: 'ready' },
        { guard: 'isLoading', target: 'loading' },
        { guard: 'isUnavailable', target: 'error' },
        { target: 'ready' },
      ],
    },
    loading: {},
    ready: {
      on: {
        acknowledge: [
          { guard: 'isMemory', actions: 'markLocalAcknowledged' },
          { target: 'saving', actions: 'clearError' },
        ],
      },
    },
    saving: {
      invoke: {
        src: 'persistAcknowledgement',
        input: ({ context }) => ({ write: context.write }),
        onDone: [
          { guard: 'persistenceAccepted', target: 'ready', actions: 'markAcknowledged' },
          { guard: 'scopeAlreadyAcknowledged', target: 'ready', actions: 'markAcknowledged' },
          { guard: 'isUnavailable', target: 'error', actions: 'markUnavailable' },
          { target: 'error', actions: 'markPersistenceFailure' },
        ],
        onError: [
          { guard: 'scopeAlreadyAcknowledged', target: 'ready', actions: 'markAcknowledged' },
          { guard: 'isUnavailable', target: 'error', actions: 'markUnavailable' },
          { target: 'error', actions: 'markPersistenceFailure' },
        ],
      },
      on: {
        'scope.changed': { actions: 'updateScope' },
      },
    },
    error: {
      on: {
        acknowledge: [
          { guard: 'isMemory', target: 'ready', actions: 'markLocalAcknowledged' },
          { target: 'saving', actions: 'clearError' },
        ],
      },
    },
  },
})
