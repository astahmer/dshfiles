import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { createQueueEditMachine } from './queue-edit-machine.js'
import type { QueueEditPorts, QueueEditView, QueuedRow } from './queue-edit-model.js'

/**
 * Editing a queued message in the main composer.
 *
 * DSH 0.2 can only replace a queued message's text, so attachments cannot survive an in-place edit. The editor
 * instead takes the message out of the queue, puts its text and attachments into the composer, and remembers where
 * it stood. Submit lets the composer send as usual and then moves the new queue entry back to that position; Cancel
 * sends the original content again and moves it back the same way.
 *
 * Taking the message out first is what makes races safe: once it is out, a finishing turn cannot run it while it is
 * being edited, and nothing else can send it twice. The record of the original is saved before the removal, so a
 * reload still offers Cancel.
 */

/** How long a caller waits for a transition instead of hanging on a flow that cannot finish. */
const SETTLE_TIMEOUT_MS = 60_000

export interface QueueEditor {
  readonly getSnapshot: () => QueueEditView
  readonly subscribe: (listener: () => void) => () => void
  readonly begin: (row: QueuedRow) => Promise<void>
  readonly submit: () => void
  readonly cancel: () => Promise<void>
  /** Forget a failed restore; the original content is dropped. */
  readonly discard: () => void
  readonly dismissNotice: () => void
  readonly dispose: () => void
}

export const createQueueEditor = <DraftId extends string, Attachment>(ports: QueueEditPorts<DraftId, Attachment>): QueueEditor => {
  const actor = createActor(createQueueEditMachine<DraftId, Attachment>(), { input: { ports } }).start()
  type Snapshot = ReturnType<typeof actor.getSnapshot>
  const listeners = new Set<() => void>()
  const viewOf = (snapshot: Snapshot): QueueEditView => ({
    record: snapshot.context.record,
    loading: snapshot.matches('loading'),
    notice: snapshot.context.notice,
  })
  let view = viewOf(actor.getSnapshot())
  const subscription = actor.subscribe(snapshot => {
    view = viewOf(snapshot)
    for (const listener of listeners) listener()
  })
  const settled = async (predicate: (snapshot: Snapshot) => boolean): Promise<void> => {
    await waitFor(actor, predicate, { timeout: SETTLE_TIMEOUT_MS })
  }

  return {
    getSnapshot: () => view,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    begin: async row => {
      actor.send({ type: 'BEGIN', row })
      await settled(snapshot => !snapshot.matches('loading'))
    },
    submit: () => actor.send({ type: 'SUBMIT' }),
    cancel: async () => {
      actor.send({ type: 'CANCEL' })
      await settled(snapshot => !snapshot.matches('restore'))
    },
    discard: () => actor.send({ type: 'DISCARD' }),
    dismissNotice: () => actor.send({ type: 'DISMISS_NOTICE' }),
    dispose: () => {
      subscription.unsubscribe()
      actor.stop()
    },
  }
}
