import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { assign, emit, fromPromise, setup, useMachine } from '@dshfiles/plugin-ui/machine'
import { useCallback, useEffect, useMemo, useRef } from 'react'

type AutoArchiveSessionId = SessionSummary['id']

export type AutoArchiveSource = 'regular' | 'rebased' | 'all'

type AutoArchiveScan = {
  readonly operationId: number
  readonly source: AutoArchiveSource
  readonly sessionIds: readonly AutoArchiveSessionId[]
}

type AutoArchiveArchiveOutput = {
  readonly operationId: number
  readonly sessionId: AutoArchiveSessionId
  readonly status: 'archived' | 'failed'
}

type AutoArchiveContext = {
  readonly client: AutoArchiveClient
  readonly enabled: boolean
  readonly intervalMs: number
  readonly operationId: number
  readonly nextOperationId: number
  readonly activeSource: AutoArchiveSource
  readonly activeSessionIds: readonly AutoArchiveSessionId[]
  readonly remainingSessionIds: readonly AutoArchiveSessionId[]
  readonly currentSessionId: AutoArchiveSessionId | null
  readonly attemptedSessionIds: readonly AutoArchiveSessionId[]
  readonly failedSessionIds: readonly AutoArchiveSessionId[]
  readonly pendingScan: AutoArchiveScan | null
}

type AutoArchiveEvent =
  | { readonly type: 'configure'; readonly enabled: boolean; readonly intervalMs: number }
  | { readonly type: 'scan'; readonly source: AutoArchiveSource }
  | { readonly type: 'refresh'; readonly source: AutoArchiveSource }

type AutoArchiveInput = {
  readonly client: AutoArchiveClient
  readonly intervalMs: number
}

type AutoArchiveArchiveInput = {
  readonly client: AutoArchiveClient
  readonly operationId: number
  readonly sessionId: AutoArchiveSessionId
}

export type AutoArchiveSettled = {
  readonly type: 'settled'
  readonly operationId: number
  readonly failedSessionIds: readonly AutoArchiveSessionId[]
}

export type AutoArchiveClient = {
  readonly archiveSession: (sessionId: AutoArchiveSessionId) => Promise<void>
  readonly getCandidateSessionIds: (source: AutoArchiveSource) => readonly AutoArchiveSessionId[]
}

const uniqueSessionIds = (sessionIds: readonly AutoArchiveSessionId[]): AutoArchiveSessionId[] => Array.from(new Set(sessionIds))

const sameSessionIds = (left: readonly AutoArchiveSessionId[], right: readonly AutoArchiveSessionId[]): boolean =>
  left.length === right.length && left.every((sessionId, index) => sessionId === right[index])

const scansOverlap = (active: AutoArchiveSource, pending: AutoArchiveSource): boolean => active === 'all' || pending === 'all' || active === pending

const beginAutoArchiveScan = (context: AutoArchiveContext, source: AutoArchiveSource): Partial<AutoArchiveContext> => {
  const operationId = context.nextOperationId + 1
  const sessionIds = uniqueSessionIds(context.client.getCandidateSessionIds(source))
  return {
    operationId,
    nextOperationId: operationId,
    activeSource: source,
    activeSessionIds: sessionIds,
    remainingSessionIds: sessionIds,
    currentSessionId: null,
    attemptedSessionIds: [],
    failedSessionIds: [],
    pendingScan: null,
  }
}

const autoArchiveMachineDefinition = setup({
  types: {
    // SAFETY: XState reads this erased schema only for typing; the context factory supplies runtime state.
    context: {} as AutoArchiveContext,
    // SAFETY: XState reads this erased schema only for typing; callers send events through the typed machine.
    events: {} as AutoArchiveEvent,
    // SAFETY: XState reads this erased schema only for typing; useMachine provides the declared runtime input.
    input: {} as AutoArchiveInput,
    // SAFETY: XState reads this erased schema only for typing; emit actions construct the runtime event.
    emitted: {} as AutoArchiveSettled,
  },
  actors: {
    archive: fromPromise<AutoArchiveArchiveOutput, AutoArchiveArchiveInput>(async ({ input }) => {
      try {
        await input.client.archiveSession(input.sessionId)
        return { operationId: input.operationId, sessionId: input.sessionId, status: 'archived' }
      } catch {
        return { operationId: input.operationId, sessionId: input.sessionId, status: 'failed' }
      }
    }),
  },
  delays: {
    scanInterval: ({ context }) => context.intervalMs,
  },
  guards: {
    isEnabled: ({ context }) => context.enabled,
    enabledConfig: ({ event }) => event.type === 'configure' && event.enabled,
    disabledConfig: ({ event }) => event.type === 'configure' && !event.enabled,
    intervalChanged: ({ context, event }) => event.type === 'configure' && event.intervalMs !== context.intervalMs,
    hasPendingScan: ({ context }) => context.pendingScan !== null,
    pendingScanSupersedesActive: ({ context }) => context.pendingScan !== null && scansOverlap(context.activeSource, context.pendingScan.source),
    hasRemainingSessionIds: ({ context }) => context.remainingSessionIds.length > 0,
    hasActiveOperation: ({ context }) => context.operationId > 0,
  },
  actions: {
    updateConfig: assign(({ event }) => {
      if (event.type !== 'configure') return {}
      return { enabled: event.enabled, intervalMs: event.intervalMs }
    }),
    beginRequestedScan: assign(({ context, event }) => {
      if (event.type !== 'scan') return {}
      return beginAutoArchiveScan(context, event.source)
    }),
    beginScheduledScan: assign(({ context }) => beginAutoArchiveScan(context, 'all')),
    queuePendingScan: assign(({ context, event }) => {
      if (!context.enabled || (event.type !== 'scan' && event.type !== 'refresh')) return { pendingScan: null }
      const requestedSource = event.source
      const source =
        context.activeSource === 'all' || requestedSource === 'all' || (context.pendingScan !== null && context.pendingScan.source !== requestedSource)
          ? 'all'
          : requestedSource
      const sessionIds = uniqueSessionIds(context.client.getCandidateSessionIds(source))
      if (context.pendingScan?.source === source && sameSessionIds(sessionIds, context.pendingScan.sessionIds)) return {}
      if (scansOverlap(context.activeSource, source) && sameSessionIds(sessionIds, context.activeSessionIds)) {
        return context.pendingScan?.source === source ? { pendingScan: null } : {}
      }
      const operationId = context.nextOperationId + 1
      return { pendingScan: { operationId, source, sessionIds }, nextOperationId: operationId }
    }),
    startPendingScan: assign(({ context }) => {
      const pendingScan = context.pendingScan
      if (pendingScan === null) return {}
      const sessionIds = uniqueSessionIds(context.client.getCandidateSessionIds(pendingScan.source))
      const attemptedSessionIds = new Set(context.attemptedSessionIds)
      return {
        operationId: pendingScan.operationId,
        activeSource: pendingScan.source,
        activeSessionIds: sessionIds,
        remainingSessionIds: sessionIds.filter(sessionId => !attemptedSessionIds.has(sessionId)),
        currentSessionId: null,
        failedSessionIds: [],
        pendingScan: null,
      }
    }),
    selectNextSession: assign(({ context }) => {
      const [currentSessionId, ...remainingSessionIds] = context.remainingSessionIds
      if (currentSessionId === undefined) return { currentSessionId: null }
      return { currentSessionId, remainingSessionIds }
    }),
    clearPendingScan: assign({ pendingScan: null }),
    clearCurrentSession: assign({ currentSessionId: null }),
    recordUnexpectedArchiveFailure: assign(({ context }) => {
      const sessionId = context.currentSessionId
      if (sessionId === null) return { currentSessionId: null }
      return {
        currentSessionId: null,
        attemptedSessionIds: [...context.attemptedSessionIds, sessionId],
        failedSessionIds: [...context.failedSessionIds, sessionId],
      }
    }),
    emitSettled: emit(({ context }) => ({ type: 'settled', operationId: context.operationId, failedSessionIds: context.failedSessionIds })),
    clearOperation: assign({
      operationId: 0,
      activeSource: 'all',
      activeSessionIds: [],
      remainingSessionIds: [],
      currentSessionId: null,
      attemptedSessionIds: [],
      failedSessionIds: [],
      pendingScan: null,
    }),
    clearOperationPreservingPending: assign({
      operationId: 0,
      activeSource: 'all',
      activeSessionIds: [],
      remainingSessionIds: [],
      currentSessionId: null,
      attemptedSessionIds: [],
      failedSessionIds: [],
    }),
  },
}).createMachine({
  id: 'threadSidebarAutoArchive',
  context: ({ input }) => ({
    client: input.client,
    enabled: false,
    intervalMs: input.intervalMs,
    operationId: 0,
    nextOperationId: 0,
    activeSource: 'all',
    activeSessionIds: [],
    remainingSessionIds: [],
    currentSessionId: null,
    attemptedSessionIds: [],
    failedSessionIds: [],
    pendingScan: null,
  }),
  initial: 'inactive',
  states: {
    inactive: {
      on: {
        configure: [{ guard: 'enabledConfig', target: 'waiting', actions: 'updateConfig' }, { actions: 'updateConfig' }],
      },
    },
    waiting: {
      after: { scanInterval: { target: 'selecting', actions: 'beginScheduledScan' } },
      on: {
        scan: { guard: 'isEnabled', target: 'selecting', actions: 'beginRequestedScan' },
        configure: [
          { guard: 'disabledConfig', target: 'inactive', actions: 'updateConfig' },
          { guard: 'intervalChanged', target: 'waiting', reenter: true, actions: 'updateConfig' },
          { actions: 'updateConfig' },
        ],
      },
    },
    selecting: {
      always: [
        { guard: ({ context }) => !context.enabled, target: 'inactive', actions: 'clearOperation' },
        { guard: 'pendingScanSupersedesActive', target: 'selecting', actions: 'startPendingScan' },
        { guard: 'hasRemainingSessionIds', target: 'archiving', actions: 'selectNextSession' },
        { guard: 'hasActiveOperation', target: 'settling' },
        { guard: 'hasPendingScan', target: 'selecting', actions: 'startPendingScan' },
        { target: 'inactive', actions: 'clearOperation' },
      ],
      on: {
        scan: { guard: 'isEnabled', actions: 'queuePendingScan' },
        refresh: { guard: 'isEnabled', actions: 'queuePendingScan' },
        configure: [{ guard: 'disabledConfig', target: 'inactive', actions: ['updateConfig', 'clearOperation'] }, { actions: 'updateConfig' }],
      },
    },
    settling: {
      entry: 'emitSettled',
      always: [
        { guard: 'hasPendingScan', target: 'selecting', actions: 'clearOperationPreservingPending' },
        { target: 'waiting', actions: 'clearOperation' },
      ],
    },
    archiving: {
      invoke: {
        // Serialize Host archive writes because the Host API cannot abort an in-flight mutation.
        src: 'archive',
        input: ({ context }) => {
          const sessionId = context.currentSessionId
          if (sessionId === null) throw new Error('Auto-archive entered the archive state without a session ID.')
          return { client: context.client, operationId: context.operationId, sessionId }
        },
        onDone: [
          {
            guard: ({ context, event }) => event.output.operationId === context.operationId && event.output.sessionId === context.currentSessionId,
            target: 'selecting',
            actions: assign(({ context, event }) => ({
              currentSessionId: null,
              attemptedSessionIds: [...context.attemptedSessionIds, event.output.sessionId],
              failedSessionIds: event.output.status === 'failed' ? [...context.failedSessionIds, event.output.sessionId] : context.failedSessionIds,
            })),
          },
          { target: 'selecting', actions: 'clearCurrentSession' },
        ],
        onError: { target: 'selecting', actions: 'recordUnexpectedArchiveFailure' },
      },
      on: {
        scan: { guard: 'isEnabled', actions: 'queuePendingScan' },
        refresh: { guard: 'isEnabled', actions: 'queuePendingScan' },
        configure: [{ guard: 'disabledConfig', actions: ['updateConfig', 'clearPendingScan'] }, { actions: 'updateConfig' }],
      },
    },
  },
})

export const autoArchiveMachine = autoArchiveMachineDefinition

export const useAutoArchive = (input: {
  readonly client: AutoArchiveClient
  readonly enabled: boolean
  readonly intervalMs: number
  readonly onSettled: (event: AutoArchiveSettled) => void
}) => {
  const latestClient = useRef(input.client)
  latestClient.current = input.client
  const latestOnSettled = useRef(input.onSettled)
  latestOnSettled.current = input.onSettled
  const client = useMemo<AutoArchiveClient>(
    () => ({
      archiveSession: sessionId => latestClient.current.archiveSession(sessionId),
      getCandidateSessionIds: source => latestClient.current.getCandidateSessionIds(source),
    }),
    [],
  )
  const [, send, actor] = useMachine(autoArchiveMachine, { input: { client, intervalMs: input.intervalMs } })
  const requestScan = useCallback((source: AutoArchiveSource = 'all') => send({ type: 'scan', source }), [send])
  const refreshCandidates = useCallback((source: AutoArchiveSource) => send({ type: 'refresh', source }), [send])

  useEffect(() => {
    const subscription = actor.on('settled', event => latestOnSettled.current(event))
    return () => subscription.unsubscribe()
  }, [actor])

  useEffect(() => {
    send({ type: 'configure', enabled: input.enabled, intervalMs: input.intervalMs })
  }, [input.enabled, input.intervalMs, send])

  return { requestScan, refreshCandidates }
}
