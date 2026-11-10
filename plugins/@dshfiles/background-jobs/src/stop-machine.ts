import { ListSelectionModel, type ListSelection } from '@dshfiles/plugin-ui/hooks/list-selection'
import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { JobSelectionModel, type BatchStopOutcome } from './job-selection.js'
import type { JobKill } from './types.js'

/** How a stop attempt failed; the panel turns it into the localized alert text. */
export type StopFailure = { readonly kind: 'error'; readonly error: unknown } | { readonly kind: 'batch'; readonly requested: number; readonly failed: number }

export interface StopMachineInput {
  /** Cancellable Host kill; the batch actor runs it once per selected id. */
  readonly kill: (jobId: string) => Promise<JobKill>
  /** Board refresh after an attempt that reached the Host. */
  readonly refresh: () => void
}

interface StopContext extends StopMachineInput {
  readonly selection: ListSelection<string>
  readonly armedId: string | null
  /** Ids captured when the attempt started; a batch stop is not re-read from the selection. */
  readonly targetIds: readonly string[]
  readonly failure: StopFailure | null
}

type StopEvent =
  | { readonly type: 'visible'; readonly ids: readonly string[] }
  | { readonly type: 'select.toggle'; readonly id: string }
  | { readonly type: 'select.extend'; readonly id: string; readonly orderedIds: readonly string[] }
  | { readonly type: 'select.all'; readonly orderedIds: readonly string[] }
  | { readonly type: 'select.clear' }
  | { readonly type: 'arm'; readonly id: string }
  | { readonly type: 'stop' }
  | { readonly type: 'ask' }
  | { readonly type: 'cancel' }
  | { readonly type: 'confirm' }
  | { readonly type: 'xstate.done.actor.stopOne' }
  | {
      readonly type: 'xstate.done.actor.stopBatch'
      readonly output: { readonly requested: readonly string[]; readonly skipped: readonly string[]; readonly failed: readonly string[] }
    }
  | { readonly type: 'xstate.error.actor.stopOne'; readonly error: unknown }
  | { readonly type: 'xstate.error.actor.stopBatch'; readonly error: unknown }

const stopErrorOf = (event: StopEvent): { readonly error: unknown } | undefined =>
  event.type === 'xstate.error.actor.stopOne' || event.type === 'xstate.error.actor.stopBatch' ? event : undefined

interface SingleStopInput extends StopMachineInput {
  readonly jobId: string
}

interface BatchStopInput extends StopMachineInput {
  readonly ids: readonly string[]
}

const errorFailure = (error: unknown): StopFailure => ({ kind: 'error', error })

// SAFETY: XState uses empty carriers for inference; runtime input and events are typed above.
export const backgroundJobStopMachine = setup({
  types: {
    context: {} as StopContext,
    events: {} as StopEvent,
    input: {} as StopMachineInput,
  },
  actors: {
    stopOne: fromPromise<JobKill, SingleStopInput>(({ input }) => input.kill(input.jobId)),
    stopBatch: fromPromise<BatchStopOutcome, BatchStopInput>(({ input }) => JobSelectionModel.stop({ ids: input.ids, kill: input.kill })),
  },
  actions: {
    pruneSelection: assign(({ context, event }) => {
      if (event.type !== 'visible') return {}
      const next = ListSelectionModel.prune({ state: context.selection, visibleIds: event.ids })
      return next.ids.length === context.selection.ids.length && next.anchorId === context.selection.anchorId ? {} : { selection: next }
    }),
    toggleSelection: assign(({ context, event }) =>
      event.type === 'select.toggle' ? { selection: ListSelectionModel.toggle({ state: context.selection, id: event.id }) } : {},
    ),
    extendSelection: assign(({ context, event }) =>
      event.type === 'select.extend' ? { selection: ListSelectionModel.extend({ state: context.selection, orderedIds: event.orderedIds, id: event.id }) } : {},
    ),
    toggleAllSelection: assign(({ context, event }) =>
      event.type === 'select.all' ? { selection: ListSelectionModel.toggleAllVisible({ state: context.selection, orderedIds: event.orderedIds }) } : {},
    ),
    clearSelection: assign({ selection: ListSelectionModel.empty<string>() }),
    armRow: assign(({ event }) => (event.type === 'arm' ? { armedId: event.id } : {})),
    captureTargets: assign(({ context }) => ({ targetIds: [...context.selection.ids], failure: null })),
    captureArmedTarget: assign(({ context }) => ({ targetIds: context.armedId === null ? [] : [context.armedId], failure: null })),
    recordStopError: assign(({ event }) => {
      const failure = stopErrorOf(event)
      return failure === undefined ? {} : { failure: errorFailure(failure.error) }
    }),
    clearOutcome: assign({ armedId: null, targetIds: [], failure: null }),
    clearTargets: assign({ targetIds: [], failure: null }),
    clearTargetIds: assign({ targetIds: [] }),
    keepFailedIds: assign(({ event }) => (event.type === 'xstate.done.actor.stopBatch' ? { targetIds: event.output.failed } : {})),
    keepFailedSelection: assign(({ event }) => {
      if (event.type !== 'xstate.done.actor.stopBatch') return {}
      const failed = event.output.failed
      return {
        selection: { ids: failed, anchorId: failed[0] },
        targetIds: failed,
        failure: { kind: 'batch', requested: event.output.requested.length, failed: failed.length } satisfies StopFailure,
      }
    }),
    refreshBoard: ({ context }) => context.refresh(),
  },
  guards: {
    hasSelection: ({ context }) => context.selection.ids.length > 0,
    hasTargets: ({ context }) => context.targetIds.length > 0,
    hasArmedTarget: ({ context }) => context.armedId !== null,
  },
}).createMachine({
  id: 'backgroundJobStop',
  initial: 'idle',
  context: ({ input }) => ({
    kill: input.kill,
    refresh: input.refresh,
    selection: ListSelectionModel.empty<string>(),
    armedId: null,
    targetIds: [],
    failure: null,
  }),
  on: {
    visible: { actions: 'pruneSelection' },
    'select.toggle': { actions: 'toggleSelection' },
    'select.extend': { actions: 'extendSelection' },
    'select.all': { actions: 'toggleAllSelection' },
    'select.clear': { actions: 'clearSelection' },
  },
  states: {
    idle: {
      on: {
        arm: { target: 'armed', actions: 'armRow' },
        ask: { target: 'confirming', guard: 'hasSelection', actions: 'captureTargets' },
      },
    },
    armed: {
      on: {
        arm: { actions: 'armRow' },
        stop: { target: 'stopping.single', guard: 'hasArmedTarget', actions: 'captureArmedTarget' },
        ask: { target: 'confirming', guard: 'hasSelection', actions: 'captureTargets' },
      },
    },
    error: {
      on: {
        arm: { target: 'armed', actions: 'armRow' },
        stop: { target: 'stopping.single', guard: 'hasArmedTarget', actions: 'captureArmedTarget' },
        ask: { target: 'confirming', guard: 'hasSelection', actions: 'captureTargets' },
      },
    },
    confirming: {
      on: {
        arm: { target: 'armed', actions: 'armRow' },
        ask: { guard: 'hasSelection', actions: 'captureTargets' },
        cancel: { target: 'idle', actions: 'clearTargets' },
        confirm: { target: 'stopping.batch', guard: 'hasTargets' },
      },
    },
    stopping: {
      initial: 'single',
      states: {
        single: {
          invoke: {
            id: 'stopOne',
            src: 'stopOne',
            input: ({ context }) => ({ kill: context.kill, refresh: context.refresh, jobId: context.armedId ?? '' }),
            onDone: { target: '#backgroundJobStop.idle', actions: ['clearOutcome', 'refreshBoard'] },
            onError: { target: '#backgroundJobStop.error', actions: ['recordStopError', 'clearTargetIds'] },
          },
        },
        batch: {
          invoke: {
            id: 'stopBatch',
            src: 'stopBatch',
            input: ({ context }) => ({ kill: context.kill, refresh: context.refresh, ids: context.targetIds }),
            onDone: [
              {
                guard: ({ event }) => event.type === 'xstate.done.actor.stopBatch' && event.output.failed.length === 0,
                target: '#backgroundJobStop.idle',
                actions: ['clearOutcome', 'clearSelection', 'refreshBoard'],
              },
              { target: '#backgroundJobStop.confirming', actions: ['keepFailedSelection', 'refreshBoard'] },
            ],
            onError: { target: '#backgroundJobStop.confirming', actions: ['recordStopError', 'keepFailedIds', 'refreshBoard'] },
          },
        },
      },
    },
  },
})
