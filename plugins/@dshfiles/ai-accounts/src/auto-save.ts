import { assign, createActor, fromPromise, setup, waitFor } from '@dshfiles/plugin-ui/machine'
import { useRef, useState } from 'react'

export type AutoSaveStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved'; readonly at: number }
  | { readonly kind: 'error'; readonly message: string }

interface AutoSaveOptions<Value> {
  readonly save: (value: Value) => Promise<void>
  readonly equals: (left: Value, right: Value) => boolean
  readonly onStatus: (status: AutoSaveStatus) => void
  readonly delayMs: () => number
  readonly now?: () => number
}

type Held<Value> = { readonly value: Value } | null

/**
 * idle → waiting (debounce) → saving → idle. The latest scheduled value always wins: a value scheduled while a save
 * runs waits for it and then saves once, so two writes never race and an older one never lands after a newer one. A
 * failed save keeps its value so `retry` can resend it, and a value equal to the last saved one is never written
 * again, which stops a Host-normalized field from re-saving forever.
 */
const autoSaveMachine = <Value>(options: AutoSaveOptions<Value>) => {
  const now = options.now ?? Date.now
  const failure = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))
  return setup({
    types: {
      context: {} as { readonly pending: Held<Value>; readonly inFlight: Held<Value>; readonly lastSaved: Held<Value>; readonly status: AutoSaveStatus },
      events: {} as
        | { readonly type: 'schedule'; readonly value: Value }
        | { readonly type: 'flush' }
        | { readonly type: 'cancel' }
        | { readonly type: 'markSaved'; readonly value: Value },
    },
    actors: { save: fromPromise<void, { readonly value: Value }>(({ input }) => options.save(input.value)) },
    delays: { debounce: () => options.delayMs() },
    guards: {
      sameAsSaved: ({ context, event }) => event.type === 'schedule' && context.lastSaved !== null && options.equals(context.lastSaved.value, event.value),
      hasPending: ({ context }) => context.pending !== null,
    },
  }).createMachine({
    id: 'autoSave',
    context: { pending: null, inFlight: null, lastSaved: null, status: { kind: 'idle' } },
    initial: 'idle',
    on: {
      markSaved: { actions: assign(({ event }) => ({ lastSaved: { value: event.value } })) },
    },
    states: {
      idle: {
        on: {
          schedule: [
            { guard: 'sameAsSaved', actions: assign({ pending: null }) },
            { target: 'waiting', actions: assign(({ event }) => ({ pending: { value: event.value }, status: { kind: 'pending' } as const })) },
          ],
          flush: { guard: 'hasPending', target: 'saving' },
          cancel: { actions: assign({ pending: null, status: { kind: 'idle' } }) },
        },
      },
      waiting: {
        after: { debounce: 'saving' },
        on: {
          schedule: [
            { guard: 'sameAsSaved', target: 'idle', actions: assign({ pending: null }) },
            { target: 'waiting', reenter: true, actions: assign(({ event }) => ({ pending: { value: event.value }, status: { kind: 'pending' } as const })) },
          ],
          flush: 'saving',
          cancel: { target: 'idle', actions: assign({ pending: null, status: { kind: 'idle' } }) },
        },
      },
      saving: {
        entry: assign(({ context }) => ({ inFlight: context.pending, pending: null, status: { kind: 'saving' } as const })),
        invoke: {
          src: 'save',
          input: ({ context }) => {
            if (context.inFlight === null) throw new Error('Nothing to save.')
            return { value: context.inFlight.value }
          },
          onDone: [
            { guard: 'hasPending', target: 'saving', reenter: true, actions: assign(({ context }) => ({ lastSaved: context.inFlight })) },
            { target: 'idle', actions: assign(({ context }) => ({ lastSaved: context.inFlight, inFlight: null, status: { kind: 'saved', at: now() } as const })) },
          ],
          onError: {
            target: 'idle',
            actions: assign(({ context, event }) => ({
              pending: context.pending ?? context.inFlight,
              inFlight: null,
              status: { kind: 'error', message: failure(event.error) } as const,
            })),
          },
        },
        on: {
          schedule: { actions: assign(({ event }) => ({ pending: { value: event.value }, status: { kind: 'pending' } as const })) },
          cancel: { actions: assign({ pending: null, status: { kind: 'idle' } }) },
        },
      },
    },
  })
}

/** Debounced, serialized persistence for an edited value; the actor lives as long as the saver, not a render. */
export const createAutoSaver = <Value>(options: AutoSaveOptions<Value>) => {
  const actor = createActor(autoSaveMachine(options))
  let reported: AutoSaveStatus | undefined
  actor.subscribe(snapshot => {
    if (snapshot.context.status === reported) return
    reported = snapshot.context.status
    options.onStatus(reported)
  })
  actor.start()

  const settle = async (): Promise<void> => {
    actor.send({ type: 'flush' })
    await waitFor(actor, snapshot => snapshot.matches('idle'))
  }

  return {
    schedule: (value: Value): void => actor.send({ type: 'schedule', value }),
    /** Save now whatever is waiting, e.g. before the edited account changes. */
    flush: settle,
    retry: settle,
    /** Forget unsaved work, for Revert or a switch to manual mode. */
    cancel: (): void => actor.send({ type: 'cancel' }),
    /** Treat a value as already persisted, e.g. after a manual save or a fresh load. */
    markSaved: (value: Value): void => actor.send({ type: 'markSaved', value }),
  }
}

export type AutoSaver<Value> = ReturnType<typeof createAutoSaver<Value>>

/** The one auto-saver both account editors use; callbacks always see the latest render's `save` and delay. */
export const useAutoSaver = <Value>(options: {
  readonly save: (value: Value) => Promise<void>
  readonly equals: (left: Value, right: Value) => boolean
  readonly delayMs: number
}): { readonly saver: AutoSaver<Value>; readonly status: AutoSaveStatus } => {
  const [status, setStatus] = useState<AutoSaveStatus>({ kind: 'idle' })
  const latest = useRef(options)
  latest.current = options
  const saverRef = useRef<AutoSaver<Value> | null>(null)
  saverRef.current ??= createAutoSaver<Value>({
    save: value => latest.current.save(value),
    equals: (left, right) => latest.current.equals(left, right),
    onStatus: setStatus,
    delayMs: () => latest.current.delayMs,
  })
  return { saver: saverRef.current, status }
}
