import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { assign, fromPromise, setup, useMachine } from '@dshfiles/plugin-ui/machine'
import { useEffect, useMemo, useRef } from 'react'
import type { ContentHit } from './palette.js'

export type ContentSearch = (query: string, signal: AbortSignal) => Promise<readonly ContentHit[]>

interface ContentSearchClient {
  readonly search: ContentSearch
}

interface ContentSearchInput {
  readonly client: ContentSearchClient
}

interface ContentState {
  readonly status: 'idle' | 'searching' | 'done' | 'failed'
  readonly hits: readonly ContentHit[]
}

interface ContentSearchContext {
  readonly client: ContentSearchClient
  readonly query: string
  readonly requestId: number
  readonly activeRequestId: number | null
  readonly state: ContentState
}

type ContentSearchEvent = { readonly type: 'query.change'; readonly query: string; readonly available: boolean } | { readonly type: 'query.refresh' }
type ContentSearchOutput =
  | { readonly kind: 'done'; readonly requestId: number; readonly hits: readonly ContentHit[] }
  | { readonly kind: 'failed'; readonly requestId: number }

const NO_CONTENT: ContentState = { status: 'idle', hits: [] }

const hasSearchInput = ({ event }: { readonly event: ContentSearchEvent }): boolean =>
  event.type === 'query.change' && event.available && event.query.trim().length > 0

// SAFETY: XState uses these empty carriers for inference; runtime values come from the input and typed events.
export const contentSearchMachine = setup({
  types: {
    input: {} as ContentSearchInput,
    context: {} as ContentSearchContext,
    events: {} as ContentSearchEvent,
  },
  actors: {
    search: fromPromise<ContentSearchOutput, { readonly client: ContentSearchClient; readonly query: string; readonly requestId: number }>(
      async ({ input, signal }) => {
        try {
          return { kind: 'done', requestId: input.requestId, hits: await input.client.search(input.query, signal) }
        } catch {
          return { kind: 'failed', requestId: input.requestId }
        }
      },
    ),
  },
  guards: { hasSearchInput },
  actions: {
    beginSearch: assign(({ context, event }) => {
      if (event.type !== 'query.change') return {}
      const requestId = context.requestId + 1
      return { query: event.query, requestId, activeRequestId: requestId, state: { ...context.state, status: 'searching' as const } }
    }),
    refreshSearch: assign(({ context }) => {
      const requestId = context.requestId + 1
      return { requestId, activeRequestId: requestId, state: { ...context.state, status: 'searching' as const } }
    }),
    clearSearch: assign(() => ({ query: '', activeRequestId: null, state: NO_CONTENT })),
    failSearch: assign(() => ({ activeRequestId: null, state: { status: 'failed' as const, hits: [] } })),
  },
}).createMachine({
  id: 'paletteContentSearch',
  context: ({ input }) => ({ client: input.client, query: '', requestId: 0, activeRequestId: null, state: NO_CONTENT }),
  initial: 'idle',
  states: {
    idle: {
      on: {
        'query.change': [{ guard: 'hasSearchInput', target: 'searching', actions: 'beginSearch' }, { actions: 'clearSearch' }],
      },
    },
    searching: {
      invoke: {
        src: 'search',
        input: ({ context }) => ({ client: context.client, query: context.query, requestId: context.requestId }),
        onDone: [
          {
            guard: ({ context, event }) => event.output.requestId === context.activeRequestId,
            target: 'settled',
            actions: assign(({ context, event }) => {
              const result = event.output
              if (result.requestId !== context.activeRequestId) return {}
              return result.kind === 'done'
                ? { activeRequestId: null, state: { status: 'done' as const, hits: result.hits } }
                : { activeRequestId: null, state: { status: 'failed' as const, hits: [] } }
            }),
          },
          { target: 'idle', actions: 'clearSearch' },
        ],
        onError: { target: 'settled', actions: 'failSearch' },
      },
      on: {
        'query.change': [
          { guard: 'hasSearchInput', target: 'searching', reenter: true, actions: 'beginSearch' },
          { target: 'idle', actions: 'clearSearch' },
        ],
        'query.refresh': { target: 'searching', reenter: true, actions: 'refreshSearch' },
      },
    },
    settled: {
      on: {
        'query.change': [
          { guard: 'hasSearchInput', target: 'searching', actions: 'beginSearch' },
          { target: 'idle', actions: 'clearSearch' },
        ],
        'query.refresh': { target: 'searching', actions: 'refreshSearch' },
      },
    },
  },
})

export const useContentSearch = (
  query: string,
  search: ContentSearch | null,
  sourceRevision: readonly { readonly id: string; readonly updatedAt: number }[],
): ContentState => {
  const latestSearch = useRef(search)
  latestSearch.current = search
  const client = useMemo<ContentSearchClient>(
    () => ({
      search: (nextQuery, signal) => {
        const current = latestSearch.current
        return current === null ? Promise.resolve([]) : current(nextQuery, signal)
      },
    }),
    [],
  )
  const debouncedQuery = useDebouncedValue({ value: query.trim(), delayMs: 200 })
  const [snapshot, send] = useMachine(contentSearchMachine, { input: { client } })
  const searchCycle = useRef({ query: '', search, sourceRevision, retries: 0 })
  useEffect(() => {
    const cycle = searchCycle.current
    if (cycle.query !== debouncedQuery || cycle.search !== search) {
      searchCycle.current = { query: debouncedQuery, search, sourceRevision, retries: 0 }
      send({ type: 'query.change', query: debouncedQuery, available: search !== null })
      return
    }
    if (debouncedQuery.length === 0 || search === null) {
      cycle.sourceRevision = sourceRevision
      cycle.retries = 0
      return
    }
    const state = snapshot.context.state
    if (state.status !== 'done' || state.hits.length > 0 || cycle.retries >= 2 || cycle.sourceRevision === sourceRevision) return
    searchCycle.current = { ...cycle, sourceRevision, retries: cycle.retries + 1 }
    send({ type: 'query.refresh' })
  }, [debouncedQuery, search, snapshot.context.state, sourceRevision, send])
  return snapshot.context.state
}
