import { createActor, fromCallback, setup, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { useEffect } from 'react'

/**
 * Keeps a thread's draft attachments alive while the user looks at another thread.
 *
 * DSH persists only the composer's text. Its draft attachments live in the thread's session scope, and leaving the
 * thread releases the last reference to that scope, which disposes the composer and drops every attached file. So
 * while a composer holds attachments, this retains its session; once they are sent or removed, it lets go.
 */

interface RetentionInput {
  /** Take one reference on the session; the returned function releases it. */
  readonly retain: () => () => void
}

type RetentionEvent = { readonly type: 'attachments'; readonly count: number }

// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const draftAttachmentRetentionMachine = setup({
  types: { input: {} as RetentionInput, context: {} as RetentionInput, events: {} as RetentionEvent },
  actors: { retention: fromCallback<RetentionEvent, RetentionInput>(({ input }) => input.retain()) },
}).createMachine({
  id: 'draftAttachmentRetention',
  context: ({ input }) => input,
  initial: 'released',
  states: {
    released: { on: { attachments: { guard: ({ event }) => event.count > 0, target: 'retained' } } },
    retained: {
      invoke: { src: 'retention', input: ({ context }) => context },
      on: { attachments: { guard: ({ event }) => event.count === 0, target: 'released' } },
    },
  },
})

export interface DraftAttachmentKeeper<SessionId extends string> {
  /** The composer of `sessionId` now holds `count` draft attachments. */
  readonly report: (sessionId: SessionId, count: number) => void
  /** Release every session still held. */
  readonly dispose: () => void
}

export const createDraftAttachmentKeeper = <SessionId extends string>(input: {
  readonly retain: (sessionId: SessionId) => () => void
}): DraftAttachmentKeeper<SessionId> => {
  const retentions = new Map<SessionId, ActorRefFrom<typeof draftAttachmentRetentionMachine>>()
  return {
    report: (sessionId, count) => {
      let actor = retentions.get(sessionId)
      if (actor === undefined) {
        if (count === 0) return
        actor = createActor(draftAttachmentRetentionMachine, { input: { retain: () => input.retain(sessionId) } }).start()
        retentions.set(sessionId, actor)
      }
      actor.send({ type: 'attachments', count })
      if (actor.getSnapshot().matches('released')) {
        actor.stop()
        retentions.delete(sessionId)
      }
    },
    dispose: () => {
      for (const actor of retentions.values()) actor.stop()
      retentions.clear()
    },
  }
}

/**
 * Report the mounted composer's attachment count. Unmounting deliberately reports nothing: leaving the thread is
 * exactly when the attachments must stay held.
 */
export const useDraftAttachmentRetention = <SessionId extends string>(input: {
  readonly keeper: DraftAttachmentKeeper<SessionId>
  readonly sessionId: SessionId
  readonly count: number
}): void => {
  useEffect(() => input.keeper.report(input.sessionId, input.count), [input.keeper, input.sessionId, input.count])
}
