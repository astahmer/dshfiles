import type { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import type { ApiClientInput, ApiClientOutput } from '@dshfiles/dshx/api'
import { assign, emit, fromPromise, setup, useMachine } from '@dshfiles/plugin-ui/machine'
import { useEffect, useRef } from 'react'

const MAX_CONCURRENT_RESUMES = 3

type ResumeQuotaMethod = (typeof aiAccountsApi.methods)['resumeQuotaContinuation']

export interface ResumeAllUsageLimitClient {
  readonly resumeQuotaContinuation: (
    input: ApiClientInput<ResumeQuotaMethod>,
    options: { readonly signal: AbortSignal },
  ) => Promise<ApiClientOutput<ResumeQuotaMethod>>
}

export type ResumeAllUsageLimitResult = {
  readonly continuationId: string
  readonly status: 'accepted' | 'rejected' | 'failed'
}

export interface ResumeAllUsageLimitSettled {
  readonly type: 'settled'
  readonly operationId: number
  readonly results: readonly ResumeAllUsageLimitResult[]
}

interface ResumeAllUsageLimitOperationInput {
  readonly client: ResumeAllUsageLimitClient
  readonly continuationIds: readonly string[]
  readonly operationId: number
}

interface ResumeAllUsageLimitOperationOutput {
  readonly operationId: number
  readonly results: readonly ResumeAllUsageLimitResult[]
}

interface ResumeAllUsageLimitContext {
  readonly client: ResumeAllUsageLimitClient
  readonly continuationIds: readonly string[]
  readonly busyIds: readonly string[]
  readonly operationId: number
  readonly nextOperationId: number
}

interface ResumeAllUsageLimitInput {
  readonly client: ResumeAllUsageLimitClient
}

type ResumeAllUsageLimitEvent = { readonly type: 'start'; readonly continuationIds: readonly string[] }

const settledEvent = (operationId: number, results: readonly ResumeAllUsageLimitResult[]): ResumeAllUsageLimitSettled => ({
  type: 'settled',
  operationId,
  results,
})

const runResumeAll = async (input: ResumeAllUsageLimitOperationInput, signal: AbortSignal): Promise<ResumeAllUsageLimitOperationOutput> => {
  const results = new Map<string, ResumeAllUsageLimitResult>()
  let nextIndex = 0
  const resumeNext = async (): Promise<void> => {
    while (!signal.aborted) {
      const continuationId = input.continuationIds[nextIndex]
      nextIndex += 1
      if (continuationId === undefined) return
      try {
        const result = await input.client.resumeQuotaContinuation({ continuationId }, { signal })
        results.set(continuationId, { continuationId, status: result.accepted ? 'accepted' : 'rejected' })
      } catch (error) {
        if (signal.aborted) throw error
        results.set(continuationId, { continuationId, status: 'failed' })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_RESUMES, input.continuationIds.length) }, () => resumeNext()))
  if (signal.aborted) throw new Error('Resume-all operation was cancelled.')
  return {
    operationId: input.operationId,
    results: input.continuationIds
      .map(continuationId => results.get(continuationId))
      .filter((result): result is ResumeAllUsageLimitResult => result !== undefined),
  }
}

// SAFETY: XState uses these empty carriers for inference; runtime context and events are established by machine transitions.
const resumeAllUsageLimitsMachineDefinition = setup({
  types: {
    context: {} as ResumeAllUsageLimitContext,
    events: {} as ResumeAllUsageLimitEvent,
    input: {} as ResumeAllUsageLimitInput,
    emitted: {} as ResumeAllUsageLimitSettled,
  },
  actors: {
    run: fromPromise<ResumeAllUsageLimitOperationOutput, ResumeAllUsageLimitOperationInput>(({ input, signal }) => runResumeAll(input, signal)),
  },
  guards: {
    hasItems: ({ event }) => event.type === 'start' && event.continuationIds.some(continuationId => continuationId.length > 0),
  },
  actions: {
    captureOperation: assign(({ context, event }) => {
      if (event.type !== 'start') return {}
      const continuationIds = Array.from(new Set(event.continuationIds.filter(continuationId => continuationId.length > 0)))
      const operationId = context.nextOperationId + 1
      return { continuationIds, busyIds: continuationIds, operationId, nextOperationId: operationId }
    }),
    clearBusyIds: assign({ busyIds: [] }),
  },
}).createMachine({
  id: 'resumeAllUsageLimits',
  context: ({ input }) => ({ client: input.client, continuationIds: [], busyIds: [], operationId: 0, nextOperationId: 0 }),
  initial: 'idle',
  states: {
    idle: {
      on: { start: { guard: 'hasItems', target: 'running', actions: 'captureOperation' } },
    },
    running: {
      tags: ['busy'],
      invoke: {
        src: 'run',
        input: ({ context }) => ({ client: context.client, continuationIds: context.continuationIds, operationId: context.operationId }),
        onDone: [
          {
            guard: ({ context, event }) => event.output.operationId === context.operationId,
            target: 'idle',
            actions: ['clearBusyIds', emit(({ event }) => settledEvent(event.output.operationId, event.output.results))],
          },
          { target: 'idle', actions: 'clearBusyIds' },
        ],
        onError: {
          target: 'idle',
          actions: [
            'clearBusyIds',
            emit(({ context }) =>
              settledEvent(
                context.operationId,
                context.continuationIds.map(continuationId => ({ continuationId, status: 'failed' })),
              ),
            ),
          ],
        },
      },
    },
  },
})

export const resumeAllUsageLimitsMachine = resumeAllUsageLimitsMachineDefinition

export const useResumeAllUsageLimits = (input: {
  readonly client: ResumeAllUsageLimitClient
  readonly onSettled: (event: ResumeAllUsageLimitSettled) => void
}) => {
  const [snapshot, send, actor] = useMachine(resumeAllUsageLimitsMachine, { input: { client: input.client } })
  const onSettled = useRef(input.onSettled)
  onSettled.current = input.onSettled
  useEffect(() => {
    const subscription = actor.on('settled', event => onSettled.current(event))
    return () => subscription.unsubscribe()
  }, [actor])
  return {
    busy: snapshot.hasTag('busy'),
    busyIds: snapshot.context.busyIds,
    start: (continuationIds: readonly string[]): void => send({ type: 'start', continuationIds }),
  }
}
