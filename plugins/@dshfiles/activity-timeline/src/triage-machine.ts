import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { SnoozeChoice } from './inbox-view.js'

/**
 * Triage: one Inbox item at a time, Needs you first, then Ready, until Inbox zero (plan Q2 T2.3).
 *
 * The flow has tangled states — showing an item, waiting on its action, the empty end — plus an async action whose
 * result decides whether to advance, so one machine owns it (plugin-state). The queue is frozen when the run starts:
 * items that arrive during the run wait for the next run instead of jumping in ahead of the one on screen. Items that
 * leave on their own (resolved elsewhere) are skipped. The machine never runs Land: Land only opens its confirmation.
 */
export type TriageRequest =
  | { readonly kind: 'done'; readonly id: string }
  | { readonly kind: 'snooze'; readonly id: string; readonly choice?: SnoozeChoice }
  | { readonly kind: 'act'; readonly id: string; readonly verb: 'Answer' | 'Approve' | 'Retry' | 'Resume' | 'Land'; readonly choiceId?: string }

export interface TriageContext {
  /** Item ids in triage order, frozen at the start of the run. */
  readonly queue: readonly string[]
  /** Ids still open in the Inbox, refreshed while the run goes on. */
  readonly open: ReadonlySet<string>
  readonly position: number
  readonly handled: number
  /** Items passed over with Skip; they stay open for the next run. */
  readonly skipped: number
  readonly error: string | null
}

export type TriageEvent =
  | { readonly type: 'start'; readonly needsYou: readonly string[]; readonly ready: readonly string[] }
  | { readonly type: 'items'; readonly open: readonly string[] }
  | { readonly type: 'act'; readonly request: TriageRequest }
  | { readonly type: 'skip' }
  | { readonly type: 'exit' }

/** The first position at or after `from` whose item is still open; the queue length when none is. */
const nextOpen = (queue: readonly string[], open: ReadonlySet<string>, from: number): number => {
  for (let index = Math.max(0, from); index < queue.length; index += 1) {
    const id = queue[index]
    if (id !== undefined && open.has(id)) return index
  }
  return queue.length
}

const EMPTY: TriageContext = { queue: [], open: new Set(), position: 0, handled: 0, skipped: 0, error: null }

// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const triageMachine = setup({
  types: { context: {} as TriageContext, events: {} as TriageEvent },
  actors: {
    run: fromPromise<void, TriageRequest>(async () => {
      throw new Error('triage: provide the run actor')
    }),
  },
  guards: {
    exhausted: ({ context }) => nextOpen(context.queue, context.open, context.position) >= context.queue.length,
  },
}).createMachine({
  id: 'inbox-triage',
  context: EMPTY,
  initial: 'list',
  states: {
    list: {
      on: {
        start: {
          target: 'running',
          actions: assign(({ event }) => {
            const queue = [...new Set([...event.needsYou, ...event.ready])]
            return { queue, open: new Set(queue), position: 0, handled: 0, skipped: 0, error: null }
          }),
        },
      },
    },
    running: {
      initial: 'choosing',
      on: {
        exit: { target: 'list', actions: assign(() => EMPTY) },
        items: {
          actions: assign(({ context, event }) => {
            const open = new Set(event.open)
            return { open, position: nextOpen(context.queue, open, context.position) }
          }),
        },
      },
      states: {
        choosing: {
          always: [{ guard: 'exhausted', target: '#inbox-triage.zero' }, { target: 'showing' }],
        },
        showing: {
          on: {
            items: {
              target: 'choosing',
              actions: assign(({ context, event }) => {
                const open = new Set(event.open)
                return { open, position: nextOpen(context.queue, open, context.position) }
              }),
            },
            act: { target: 'acting' },
            skip: { target: 'choosing', actions: assign(({ context }) => ({ position: context.position + 1, skipped: context.skipped + 1, error: null })) },
          },
        },
        acting: {
          invoke: {
            src: 'run',
            input: ({ event }) => {
              if (event.type !== 'act') throw new Error('triage: acting starts from an act event')
              return event.request
            },
            onDone: {
              target: 'choosing',
              actions: assign(({ context }) => {
                // The acted item leaves the run whether or not the list has refreshed yet.
                const id = context.queue[context.position]
                const open = new Set(context.open)
                if (id !== undefined) open.delete(id)
                return { open, position: nextOpen(context.queue, open, context.position + 1), handled: context.handled + 1, error: null }
              }),
            },
            onError: {
              target: 'showing',
              actions: assign(({ event }) => ({ error: event.error instanceof Error ? event.error.message : String(event.error) })),
            },
          },
        },
      },
    },
    zero: {
      on: {
        exit: { target: 'list', actions: assign(() => EMPTY) },
        start: {
          target: 'running',
          actions: assign(({ event }) => {
            const queue = [...new Set([...event.needsYou, ...event.ready])]
            return { queue, open: new Set(queue), position: 0, handled: 0, skipped: 0, error: null }
          }),
        },
      },
    },
  },
})

/** "2 of 5" in numbers. */
export interface TriageProgress {
  readonly index: number
  readonly total: number
}

export const TriageModel = {
  nextOpen,
  /** The item on screen, or undefined at Inbox zero or in the list. */
  current: (context: TriageContext): string | undefined => context.queue[context.position],
  /** "2 of 5": items already handled or skipped, plus the open ones still ahead (the one on screen included). */
  progress: (context: TriageContext): TriageProgress => {
    const seen = context.handled + context.skipped
    const ahead = context.queue.slice(context.position).filter(id => context.open.has(id)).length
    return { index: Math.min(seen + 1, seen + ahead), total: seen + ahead }
  },
} as const
