import { assign, emit, fromPromise, setup, useMachine } from '@dshfiles/plugin-ui/machine'
import { useEffect, useRef } from 'react'

interface DiscardTarget {
  readonly path: string
  readonly name: string
  readonly unlandedCount: number
}

interface DiscardClient {
  readonly discard: (
    input: { readonly path: string; readonly force: boolean },
    options: { readonly signal: AbortSignal },
  ) => Promise<{ readonly status: 'discarded' | 'has-work' }>
}

export type DiscardFailure = { readonly kind: 'has-work' } | { readonly kind: 'failed'; readonly message: string | null }

interface DiscardContext {
  readonly client: DiscardClient
  readonly target: DiscardTarget | null
  readonly failure: DiscardFailure | null
}

interface DiscardInput {
  readonly client: DiscardClient
}

interface DiscardSettled {
  readonly type: 'settled'
}

type DiscardEvent = { readonly type: 'request'; readonly target: DiscardTarget } | { readonly type: 'confirm' } | { readonly type: 'cancel' }

/**
 * closed → confirming → discarding → closed, or → failed when the Host refuses or errors. Force is used only when the
 * dialog named unlanded revisions, so what it names is what gets deleted.
 */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const discardMachine = setup({
  types: {
    context: {} as DiscardContext,
    events: {} as DiscardEvent,
    input: {} as DiscardInput,
    emitted: {} as DiscardSettled,
  },
  actors: {
    discard: fromPromise<{ readonly status: 'discarded' | 'has-work' }, { readonly client: DiscardClient; readonly path: string; readonly force: boolean }>(
      ({ input, signal }) => input.client.discard({ path: input.path, force: input.force }, { signal }),
    ),
  },
}).createMachine({
  id: 'threadDiscard',
  context: ({ input }) => ({ client: input.client, target: null, failure: null }),
  initial: 'closed',
  states: {
    closed: {
      on: { request: { target: 'confirming', actions: assign(({ event }) => ({ target: event.target, failure: null })) } },
    },
    confirming: {
      on: { confirm: 'discarding', cancel: { target: 'closed', actions: assign({ target: null }) } },
    },
    discarding: {
      tags: ['busy'],
      invoke: {
        src: 'discard',
        input: ({ context }) => ({ client: context.client, path: context.target?.path ?? '', force: (context.target?.unlandedCount ?? 0) > 0 }),
        onDone: [
          {
            guard: ({ event }) => event.output.status === 'has-work',
            target: 'failed',
            actions: [assign({ failure: { kind: 'has-work' } }), emit({ type: 'settled' })],
          },
          { target: 'closed', actions: [assign({ target: null }), emit({ type: 'settled' })] },
        ],
        onError: {
          target: 'failed',
          actions: [
            assign(({ event }) => ({
              failure: { kind: 'failed', message: event.error instanceof Error && event.error.message.length > 0 ? event.error.message : null },
            })),
            emit({ type: 'settled' }),
          ],
        },
      },
    },
    failed: {
      // Work that appeared after the dialog opened is never deleted unseen: only a Host error can be retried.
      on: {
        confirm: { guard: ({ context }) => context.failure?.kind === 'failed', target: 'discarding' },
        cancel: { target: 'closed', actions: assign({ target: null, failure: null }) },
      },
    },
  },
})

/** The confirmation dialog's state for one panel; `onSettled` runs after every Host attempt. */
export const useDiscardConfirmation = (input: { readonly client: DiscardClient; readonly onSettled: () => void }) => {
  const [snapshot, send, actor] = useMachine(discardMachine, { input: { client: input.client } })
  const onSettled = useRef(input.onSettled)
  onSettled.current = input.onSettled
  useEffect(() => {
    const subscription = actor.on('settled', () => onSettled.current())
    return () => subscription.unsubscribe()
  }, [actor])
  return {
    target: snapshot.matches('closed') ? null : snapshot.context.target,
    failure: snapshot.context.failure,
    busy: snapshot.hasTag('busy'),
    request: (target: DiscardTarget): void => send({ type: 'request', target }),
    confirm: (): void => send({ type: 'confirm' }),
    cancel: (): void => send({ type: 'cancel' }),
  }
}
