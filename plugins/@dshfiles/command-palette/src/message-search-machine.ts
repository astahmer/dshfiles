import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { assign, fromPromise, setup, useMachine } from '@dshfiles/plugin-ui/machine'
import { useEffect, useMemo, useRef } from 'react'
import type { MessageHit, MessageSearch, MessageSearchOutcome, MessageSearchRole } from './message-search-source.js'

interface MessageSearchClient {
  readonly search: MessageSearch
}

interface MessageSearchInput {
  readonly client: MessageSearchClient
}

export interface MessageSearchState {
  readonly status: 'idle' | 'searching' | 'done' | 'unavailable' | 'failed'
  readonly hits: readonly MessageHit[]
  readonly hasMore: boolean
}

interface MessageSearchContext {
  readonly client: MessageSearchClient
  readonly query: string
  readonly role: MessageSearchRole
  readonly requestId: number
  readonly activeRequestId: number | null
  readonly state: MessageSearchState
}

type MessageSearchEvent = {
  readonly type: 'query.change'
  readonly query: string
  readonly role: MessageSearchRole
  readonly available: boolean
  readonly resetHits: boolean
}

type MessageSearchOutput =
  | { readonly kind: 'done'; readonly requestId: number; readonly outcome: MessageSearchOutcome }
  | { readonly kind: 'failed'; readonly requestId: number }

const IDLE_STATE: MessageSearchState = { status: 'idle', hits: [], hasMore: false }

const hasMessageQuery = ({ event }: { readonly event: MessageSearchEvent }): boolean => event.available && event.query.trim().length > 0

// SAFETY: XState uses these empty carriers for inference; runtime values come from the input and typed events.
export const messageSearchMachine = setup({
  types: {
    input: {} as MessageSearchInput,
    context: {} as MessageSearchContext,
    events: {} as MessageSearchEvent,
  },
  actors: {
    search: fromPromise<
      MessageSearchOutput,
      { readonly client: MessageSearchClient; readonly query: string; readonly role: MessageSearchRole; readonly requestId: number }
    >(async ({ input, signal }) => {
      try {
        const outcome = await input.client.search({ query: input.query, role: input.role }, signal)
        return { kind: 'done', requestId: input.requestId, outcome }
      } catch {
        return { kind: 'failed', requestId: input.requestId }
      }
    }),
  },
  guards: { hasMessageQuery },
  actions: {
    beginSearch: assign(({ context, event }) => {
      const requestId = context.requestId + 1
      const hits = event.resetHits ? [] : context.state.hits
      const hasMore = event.resetHits ? false : context.state.hasMore
      return {
        query: event.query,
        role: event.role,
        requestId,
        activeRequestId: requestId,
        state: { status: 'searching' as const, hits, hasMore },
      }
    }),
    clearSearch: assign(({ event }) => ({ query: '', role: event.role, activeRequestId: null, state: IDLE_STATE })),
    failSearch: assign(() => ({ activeRequestId: null, state: { status: 'failed' as const, hits: [], hasMore: false } })),
  },
}).createMachine({
  id: 'paletteMessageSearch',
  context: ({ input }) => ({
    client: input.client,
    query: '',
    role: 'all',
    requestId: 0,
    activeRequestId: null,
    state: IDLE_STATE,
  }),
  initial: 'idle',
  states: {
    idle: {
      on: {
        'query.change': [{ guard: 'hasMessageQuery', target: 'searching', actions: 'beginSearch' }, { actions: 'clearSearch' }],
      },
    },
    searching: {
      invoke: {
        src: 'search',
        input: ({ context }) => ({ client: context.client, query: context.query, role: context.role, requestId: context.requestId }),
        onDone: [
          {
            guard: ({ context, event }) => event.output.requestId === context.activeRequestId,
            target: 'settled',
            actions: assign(({ context, event }) => {
              const result = event.output
              if (result.requestId !== context.activeRequestId) return {}
              if (result.kind === 'failed') return { activeRequestId: null, state: { status: 'failed' as const, hits: [], hasMore: false } }
              if (result.outcome.kind === 'unavailable') return { activeRequestId: null, state: { status: 'unavailable' as const, hits: [], hasMore: false } }
              return {
                activeRequestId: null,
                state: { status: 'done' as const, hits: result.outcome.hits, hasMore: result.outcome.hasMore },
              }
            }),
          },
          { target: 'idle', actions: assign(() => ({ query: '', activeRequestId: null, state: IDLE_STATE })) },
        ],
        onError: { target: 'settled', actions: 'failSearch' },
      },
      on: {
        'query.change': [
          { guard: 'hasMessageQuery', target: 'searching', reenter: true, actions: 'beginSearch' },
          { target: 'idle', actions: 'clearSearch' },
        ],
      },
    },
    settled: {
      on: {
        'query.change': [
          { guard: 'hasMessageQuery', target: 'searching', actions: 'beginSearch' },
          { target: 'idle', actions: 'clearSearch' },
        ],
      },
    },
  },
})

export const useMessageSearch = (input: {
  readonly active: boolean
  readonly query: string
  readonly role: MessageSearchRole
  readonly search: MessageSearch | null
}): MessageSearchState => {
  const latestSearch = useRef(input.search)
  latestSearch.current = input.search
  const client = useMemo<MessageSearchClient>(
    () => ({
      search: (request, signal) => {
        const current = latestSearch.current
        return current === null ? Promise.resolve({ kind: 'unavailable' }) : current(request, signal)
      },
    }),
    [],
  )
  const trimmed = input.active ? input.query.trim() : ''
  const debouncedQuery = useDebouncedValue({ value: trimmed, delayMs: 180 })
  const [snapshot, send] = useMachine(messageSearchMachine, { input: { client } })
  const previous = useRef<{ readonly query: string; readonly role: MessageSearchRole; readonly search: MessageSearch | null }>({
    query: '',
    role: input.role,
    search: input.search,
  })
  useEffect(() => {
    const roleChanged = previous.current.role !== input.role
    // Switching role runs right away against the current query and clears the previous role's hits.
    const effectiveQuery = roleChanged ? trimmed : debouncedQuery
    if (previous.current.query === effectiveQuery && previous.current.role === input.role && previous.current.search === input.search) return
    previous.current = { query: effectiveQuery, role: input.role, search: input.search }
    send({
      type: 'query.change',
      query: effectiveQuery,
      role: input.role,
      available: input.search !== null,
      resetHits: roleChanged,
    })
  }, [debouncedQuery, input.role, input.search, send, trimmed])
  return snapshot.context.state
}
