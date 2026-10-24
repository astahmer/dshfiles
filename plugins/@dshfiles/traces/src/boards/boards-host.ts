import type { TraceStore } from '../store.js'
import { tracesBoardsApi } from './boards-api.js'
import { SpanBreakdown } from './breakdown.js'

export const createBoardsApiHost = (store: () => TraceStore) =>
  tracesBoardsApi.host({
    breakdown: ({ input }) => SpanBreakdown.compute({ source: store(), query: input, now: Date.now() }),
  })
