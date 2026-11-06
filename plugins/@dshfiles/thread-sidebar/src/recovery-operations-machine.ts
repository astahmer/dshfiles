import { assign, emit, fromPromise, setup, useMachine } from '@dshfiles/plugin-ui/machine'
import { useCallback, useEffect, useMemo, useRef } from 'react'

export const MAX_CONCURRENT_RECOVERY_OPERATIONS = 3

export type RecoveryOperationStatus = 'accepted' | 'rejected' | 'failed'

export interface RecoveryOperationResult {
  readonly key: string
  readonly status: RecoveryOperationStatus
}

export interface RecoveryOperation {
  readonly key: string
  readonly run: (options: { readonly signal: AbortSignal }) => Promise<{ readonly accepted: boolean }>
}

export interface RecoveryBatch {
  readonly tag: string
  readonly operations: readonly RecoveryOperation[]
}

export interface RecoveryOperationsSettled {
  readonly type: 'settled'
  readonly tag: string
  readonly results: readonly RecoveryOperationResult[]
}

interface RecoveryOperationsContext {
  readonly batch: RecoveryBatch
  readonly queue: readonly RecoveryBatch[]
  readonly busyKeys: readonly string[]
}

type RecoveryOperationsEvent = {
  readonly type: 'run'
  readonly tag: string
  readonly operations: readonly RecoveryOperation[]
}

const admitOperations = (busyKeys: readonly string[], operations: readonly RecoveryOperation[]): readonly RecoveryOperation[] => {
  const admittedKeys = new Set<string>()
  return operations.filter(operation => {
    if (busyKeys.includes(operation.key) || admittedKeys.has(operation.key)) return false
    admittedKeys.add(operation.key)
    return true
  })
}

const runOperations = async (input: RecoveryBatch, signal: AbortSignal): Promise<readonly RecoveryOperationResult[]> => {
  const results = new Map<string, RecoveryOperationResult>()
  let nextIndex = 0
  const runNext = async (): Promise<void> => {
    while (!signal.aborted) {
      const operation = input.operations[nextIndex]
      nextIndex += 1
      if (operation === undefined) return
      try {
        const result = await operation.run({ signal })
        results.set(operation.key, { key: operation.key, status: result.accepted ? 'accepted' : 'rejected' })
      } catch (error) {
        if (signal.aborted) throw error
        results.set(operation.key, { key: operation.key, status: 'failed' })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_RECOVERY_OPERATIONS, input.operations.length) }, () => runNext()))
  if (signal.aborted) throw new Error('Recovery operations were cancelled.')
  return input.operations.flatMap(operation => {
    const result = results.get(operation.key)
    return result === undefined ? [] : [result]
  })
}

const EMPTY_BATCH: RecoveryBatch = { tag: '', operations: [] }

const batchOf = (event: RecoveryOperationsEvent, operations: readonly RecoveryOperation[]): RecoveryBatch => ({ tag: event.tag, operations })

// SAFETY: XState uses these empty carriers for inference; runtime context and events are established by machine transitions.
const recoveryOperationsMachineDefinition = setup({
  types: {
    context: {} as RecoveryOperationsContext,
    events: {} as RecoveryOperationsEvent,
    emitted: {} as RecoveryOperationsSettled,
  },
  actors: {
    runBatch: fromPromise<readonly RecoveryOperationResult[], RecoveryBatch>(({ input, signal }) => runOperations(input, signal)),
  },
  guards: {
    admitsOperations: ({ context, event }) => admitOperations(context.busyKeys, event.operations).length > 0,
    hasQueuedBatch: ({ context }) => context.queue.length > 0,
  },
  actions: {
    startBatch: assign(({ context, event }) => {
      const operations = admitOperations(context.busyKeys, event.operations)
      return { batch: batchOf(event, operations), busyKeys: [...context.busyKeys, ...operations.map(operation => operation.key)] }
    }),
    enqueueBatch: assign(({ context, event }) => {
      const operations = admitOperations(context.busyKeys, event.operations)
      return { queue: [...context.queue, batchOf(event, operations)], busyKeys: [...context.busyKeys, ...operations.map(operation => operation.key)] }
    }),
    startQueuedBatch: assign(({ context }) => {
      const [next, ...rest] = context.queue
      const finishedKeys = new Set(context.batch.operations.map(operation => operation.key))
      return { batch: next ?? EMPTY_BATCH, queue: rest, busyKeys: context.busyKeys.filter(key => !finishedKeys.has(key)) }
    }),
    clearBatch: assign({ batch: EMPTY_BATCH, busyKeys: [] }),
  },
}).createMachine({
  id: 'threadSidebarRecoveryOperations',
  context: { batch: EMPTY_BATCH, queue: [], busyKeys: [] },
  initial: 'idle',
  states: {
    idle: {
      on: { run: { guard: 'admitsOperations', target: 'running', actions: 'startBatch' } },
    },
    running: {
      invoke: {
        src: 'runBatch',
        input: ({ context }) => context.batch,
        onDone: {
          target: 'settling',
          actions: emit(({ context, event }) => ({ type: 'settled', tag: context.batch.tag, results: event.output })),
        },
        onError: {
          target: 'settling',
          actions: emit(({ context }) => ({
            type: 'settled',
            tag: context.batch.tag,
            results: context.batch.operations.map(operation => ({ key: operation.key, status: 'failed' as const })),
          })),
        },
      },
      on: { run: { guard: 'admitsOperations', actions: 'enqueueBatch' } },
    },
    settling: {
      always: [
        { guard: 'hasQueuedBatch', target: 'running', actions: 'startQueuedBatch' },
        { target: 'idle', actions: 'clearBatch' },
      ],
    },
  },
})

export const recoveryOperationsMachine = recoveryOperationsMachineDefinition

export const useRecoveryOperations = (input: { readonly onSettled: (settled: RecoveryOperationsSettled) => void }) => {
  const latestOnSettled = useRef(input.onSettled)
  latestOnSettled.current = input.onSettled
  const [snapshot, send, actor] = useMachine(recoveryOperationsMachine)
  useEffect(() => {
    const subscription = actor.on('settled', settled => latestOnSettled.current(settled))
    return () => subscription.unsubscribe()
  }, [actor])
  const busyKeys = useMemo(() => new Set(snapshot.context.busyKeys), [snapshot.context.busyKeys])
  const run = useCallback(
    (batch: RecoveryBatch): void => {
      send({ type: 'run', tag: batch.tag, operations: batch.operations })
    },
    [send],
  )
  return { busyKeys, running: snapshot.matches('running'), run }
}
