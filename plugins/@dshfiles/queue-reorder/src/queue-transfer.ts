import { assign, createActor, fromPromise, setup, useSelector, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import type { QueuedBlock, QueuedRow } from './queue-edit.js'

/**
 * Moving one queued message, with its attachments, to another thread.
 *
 * The message is read first (its attachment bytes), then taken out of this queue, then delivered: a busy target gets
 * it in its queue, an idle one in its composer, so nothing runs that the person did not send. Taking it out before
 * delivering is what keeps a finishing turn from running it here while it moves; if delivery fails it goes back into
 * this queue.
 */

export interface TransferTarget {
  readonly id: string
  readonly title: string
}

export type TransferDestination = 'queue' | 'composer'

export interface QueueTransferPorts {
  /** Every attachment's bytes, in block order. */
  readonly load: (blocks: readonly QueuedBlock[], signal: AbortSignal) => Promise<readonly File[]>
  /** Reject when the message already left the queue. */
  readonly remove: (itemId: string) => Promise<void>
  readonly deliver: (input: {
    readonly target: TransferTarget
    readonly blocks: readonly QueuedBlock[]
    readonly files: readonly File[]
  }) => Promise<TransferDestination>
  /** Queue the message again in the thread it came from. */
  readonly restore: (input: { readonly blocks: readonly QueuedBlock[]; readonly files: readonly File[] }) => Promise<void>
}

export type TransferOutcome =
  | { readonly kind: 'moved'; readonly target: TransferTarget; readonly destination: TransferDestination }
  | { readonly kind: 'not-moved'; readonly message: string }
  | { readonly kind: 'restored'; readonly message: string }
  | { readonly kind: 'lost'; readonly message: string; readonly text: string }

interface TransferContext {
  readonly ports: QueueTransferPorts
  readonly row: QueuedRow | null
  readonly target: TransferTarget | null
  readonly files: readonly File[]
  readonly deliveryError: string | null
  readonly outcome: TransferOutcome | null
}

type TransferEvent =
  | { readonly type: 'open'; readonly row: QueuedRow }
  | { readonly type: 'choose'; readonly target: TransferTarget }
  | { readonly type: 'cancel' }
  | { readonly type: 'dismiss' }

const messageOf = (error: unknown): string => (error instanceof Error && error.message.length > 0 ? error.message : 'unknown error')
const textOf = (blocks: readonly QueuedBlock[]): string => blocks.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
const blocksOf = (context: TransferContext): readonly QueuedBlock[] => context.row?.blocks ?? []

// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const queueTransferMachine = setup({
  types: { context: {} as TransferContext, events: {} as TransferEvent, input: {} as { readonly ports: QueueTransferPorts } },
  actors: {
    load: fromPromise<readonly File[], { readonly ports: QueueTransferPorts; readonly blocks: readonly QueuedBlock[] }>(({ input, signal }) =>
      input.ports.load(input.blocks, signal),
    ),
    remove: fromPromise<void, { readonly ports: QueueTransferPorts; readonly itemId: string }>(({ input }) => input.ports.remove(input.itemId)),
    deliver: fromPromise<
      TransferDestination,
      { readonly ports: QueueTransferPorts; readonly target: TransferTarget; readonly blocks: readonly QueuedBlock[]; readonly files: readonly File[] }
    >(({ input }) => input.ports.deliver({ target: input.target, blocks: input.blocks, files: input.files })),
    restore: fromPromise<void, { readonly ports: QueueTransferPorts; readonly blocks: readonly QueuedBlock[]; readonly files: readonly File[] }>(({ input }) =>
      input.ports.restore({ blocks: input.blocks, files: input.files }),
    ),
  },
  actions: {
    pick: assign(({ event }) => (event.type === 'open' ? { row: event.row, target: null, outcome: null } : {})),
  },
}).createMachine({
  id: 'queueTransfer',
  context: ({ input }) => ({ ports: input.ports, row: null, target: null, files: [], deliveryError: null, outcome: null }),
  initial: 'idle',
  states: {
    idle: { on: { open: { target: 'picking', actions: 'pick' } } },
    picking: {
      on: {
        open: { actions: 'pick' },
        choose: { target: 'loading', actions: assign(({ event }) => ({ target: event.target })) },
        cancel: { target: 'idle', actions: assign({ row: null }) },
      },
    },
    loading: {
      tags: ['busy'],
      invoke: {
        src: 'load',
        input: ({ context }) => ({ ports: context.ports, blocks: blocksOf(context) }),
        onDone: { target: 'removing', actions: assign(({ event }) => ({ files: event.output })) },
        onError: {
          target: 'settled',
          actions: assign(({ event }) => ({
            outcome: { kind: 'not-moved', message: `Could not read this message's attachments (${messageOf(event.error)}). It stays queued here.` },
          })),
        },
      },
    },
    removing: {
      tags: ['busy'],
      invoke: {
        src: 'remove',
        input: ({ context }) => ({ ports: context.ports, itemId: context.row?.id ?? '' }),
        onDone: 'delivering',
        onError: { target: 'settled', actions: assign({ outcome: { kind: 'not-moved', message: 'This message already left the queue.' } }) },
      },
    },
    delivering: {
      tags: ['busy'],
      invoke: {
        src: 'deliver',
        input: ({ context }) => ({ ports: context.ports, target: context.target ?? { id: '', title: '' }, blocks: blocksOf(context), files: context.files }),
        onDone: {
          target: 'settled',
          actions: assign(({ context, event }) => ({
            outcome: context.target === null ? null : { kind: 'moved', target: context.target, destination: event.output },
          })),
        },
        onError: { target: 'restoring', actions: assign(({ event }) => ({ deliveryError: messageOf(event.error) })) },
      },
    },
    restoring: {
      tags: ['busy'],
      invoke: {
        src: 'restore',
        input: ({ context }) => ({ ports: context.ports, blocks: blocksOf(context), files: context.files }),
        onDone: {
          target: 'settled',
          actions: assign(({ context }) => ({
            outcome: { kind: 'restored', message: `Could not move it (${context.deliveryError ?? 'unknown error'}); it is back at the end of this queue.` },
          })),
        },
        onError: {
          target: 'settled',
          actions: assign(({ context, event }) => ({
            outcome: {
              kind: 'lost',
              message: `Could not move it (${context.deliveryError ?? 'unknown error'}) nor put it back (${messageOf(event.error)}). Its text is below.`,
              text: textOf(blocksOf(context)),
            },
          })),
        },
      },
    },
    settled: {
      entry: assign({ row: null, files: [], deliveryError: null }),
      on: {
        dismiss: { target: 'idle', actions: assign({ outcome: null, target: null }) },
        open: { target: 'picking', actions: 'pick' },
      },
    },
  },
})

export type QueueTransferActor = ActorRefFrom<typeof queueTransferMachine>

export const startQueueTransfer = (ports: QueueTransferPorts): QueueTransferActor => createActor(queueTransferMachine, { input: { ports } }).start()

/** Threads a queued message can move to: every listed top-level thread except this one and blank new-thread drafts. */
export const transferTargets = (input: {
  readonly ids: readonly string[]
  readonly rows: Readonly<
    Record<string, { readonly displayTitle: string; readonly blank: boolean; readonly origin?: string | undefined; readonly updatedAt: number } | undefined>
  >
  readonly currentId: string
}): readonly TransferTarget[] =>
  input.ids
    .flatMap(id => {
      const row = input.rows[id]
      if (id === input.currentId || row === undefined || row.blank || row.origin === 'subagent') return []
      return [{ id, title: row.displayTitle, updatedAt: row.updatedAt }]
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(target => ({ id: target.id, title: target.title }))

/** Stands in when this DSH build cannot move messages, so the dock's hook order never changes. */
const idleTransfer = startQueueTransfer({
  load: () => Promise.reject(new Error('unavailable')),
  remove: () => Promise.reject(new Error('unavailable')),
  deliver: () => Promise.reject(new Error('unavailable')),
  restore: () => Promise.reject(new Error('unavailable')),
})

interface TransferView {
  readonly picking: boolean
  readonly busy: boolean
  readonly target: TransferTarget | null
  readonly outcome: TransferOutcome | null
}

const sameTransferView = (left: TransferView, right: TransferView): boolean =>
  left.picking === right.picking && left.busy === right.busy && left.target === right.target && left.outcome === right.outcome

/** The dock's view of one session's transfer actor. */
export const useQueueTransfer = (actor: QueueTransferActor | undefined) => {
  const state = useSelector(
    actor ?? idleTransfer,
    snapshot => ({
      picking: snapshot.matches('picking'),
      busy: snapshot.hasTag('busy'),
      target: snapshot.context.target,
      outcome: snapshot.context.outcome,
    }),
    sameTransferView,
  )
  return {
    available: actor !== undefined,
    ...state,
    open: (row: QueuedRow): void => actor?.send({ type: 'open', row }),
    choose: (target: TransferTarget): void => actor?.send({ type: 'choose', target }),
    cancel: (): void => actor?.send({ type: 'cancel' }),
    dismiss: (): void => actor?.send({ type: 'dismiss' }),
  }
}
