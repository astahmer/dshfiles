import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { assign, fromPromise, setup, useMachine } from '@dshfiles/plugin-ui/machine'
import { useEffect, useMemo, useRef } from 'react'
import {
  MessageSearchSource,
  type MessageHit,
  type MessageSearch,
  type MessageSearchOutcome,
  type MessageSearchRole,
  type MessageSearchUnavailable,
} from './message-search-source.js'

interface MessageSearchClient {
  readonly search: MessageSearch
}

interface MessageSearchInput {
  readonly client: MessageSearchClient
}

export interface MessageSearchState {
  /** `too-short` is a query under {@link MessageSearchSource.minChars} characters; `searching` covers the debounce too. */
  readonly status: 'idle' | 'too-short' | 'searching' | 'done' | 'unavailable' | 'failed'
  readonly unavailable: MessageSearchUnavailable | null
  readonly hits: readonly MessageHit[]
  readonly hasMore: boolean
}

interface MessageSearchContext {
  readonly client: MessageSearchClient
  readonly query: string
  readonly role: MessageSearchRole
  readonly state: MessageSearchState
}

type MessageSearchEvent = {
  readonly type: 'query.change'
  readonly query: string
  readonly role: MessageSearchRole
  /** Drop the previous hits at once (a sender filter change) instead of keeping them until the answer. */
  readonly resetHits: boolean
}

const IDLE_STATE: MessageSearchState = { status: 'idle', unavailable: null, hits: [], hasMore: false }
const FAILED_STATE: MessageSearchState = { status: 'failed', unavailable: null, hits: [], hasMore: false }

const settledState = (outcome: MessageSearchOutcome): MessageSearchState =>
  outcome.kind === 'unavailable'
    ? { status: 'unavailable', unavailable: outcome.reason, hits: [], hasMore: false }
    : { status: 'done', unavailable: null, hits: outcome.hits, hasMore: outcome.hasMore }

const hasMessageQuery = ({ event }: { readonly event: MessageSearchEvent }): boolean => MessageSearchSource.isSearchable(event.query)

// SAFETY: XState uses these empty carriers for inference; runtime values come from the input and typed events.
export const messageSearchMachine = setup({
  types: {
    input: {} as MessageSearchInput,
    context: {} as MessageSearchContext,
    events: {} as MessageSearchEvent,
  },
  actors: {
    search: fromPromise<MessageSearchOutcome, { readonly client: MessageSearchClient; readonly query: string; readonly role: MessageSearchRole }>(
      ({ input, signal }) => input.client.search({ query: input.query, role: input.role }, signal),
    ),
  },
  guards: { hasMessageQuery },
  actions: {
    beginSearch: assign(({ context, event }) => ({
      query: event.query,
      role: event.role,
      state: { ...(event.resetHits ? IDLE_STATE : context.state), status: 'searching' as const, unavailable: null },
    })),
    clearSearch: assign(({ event }) => ({ query: '', role: event.role, state: IDLE_STATE })),
  },
}).createMachine({
  id: 'paletteMessageSearch',
  context: ({ input }) => ({ client: input.client, query: '', role: 'all', state: IDLE_STATE }),
  initial: 'idle',
  on: {
    'query.change': [
      // A root transition exits the active child, which stops a running search: a superseded answer never lands.
      { guard: 'hasMessageQuery', target: '.searching', actions: 'beginSearch' },
      { target: '.idle', actions: 'clearSearch' },
    ],
  },
  states: {
    idle: {},
    searching: {
      invoke: {
        src: 'search',
        input: ({ context }) => ({ client: context.client, query: context.query, role: context.role }),
        onDone: { target: 'settled', actions: assign({ state: ({ event }) => settledState(event.output) }) },
        onError: { target: 'settled', actions: assign({ state: FAILED_STATE }) },
      },
    },
    settled: {},
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
        return current === null ? Promise.resolve({ kind: 'unavailable', reason: 'missing' }) : current(request, signal)
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
    // Switching the sender filter searches the current text at once and clears the previous filter's hits.
    const effectiveQuery = roleChanged ? trimmed : debouncedQuery
    if (previous.current.query === effectiveQuery && !roleChanged && previous.current.search === input.search) return
    previous.current = { query: effectiveQuery, role: input.role, search: input.search }
    send({ type: 'query.change', query: input.search === null ? '' : effectiveQuery, role: input.role, resetHits: roleChanged })
  }, [debouncedQuery, input.role, input.search, send, trimmed])
  const state = snapshot.context.state
  if (!input.active || trimmed.length === 0) return state
  if (input.search === null) return { status: 'unavailable', unavailable: 'missing', hits: [], hasMore: false }
  if (!MessageSearchSource.isSearchable(trimmed)) return { status: 'too-short', unavailable: null, hits: [], hasMore: false }
  // Until the debounced text reaches the machine, the previous answer is stale: say so instead of "No results".
  const waiting = trimmed !== debouncedQuery || state.status === 'idle'
  return waiting && state.status !== 'searching' ? { ...state, status: 'searching', unavailable: null } : state
}
