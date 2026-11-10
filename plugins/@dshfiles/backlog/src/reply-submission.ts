import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'

import { createReplyMachine, type ReplyDispatch } from './reply-machine.js'

const SETTLE_TIMEOUT_MS = 60_000

interface ReplyView<File> {
  readonly clear: () => void
  readonly restore: (input: { readonly text: string; readonly files: readonly File[] }) => void
  readonly fail: (message: string) => void
}

/**
 * Saves the reply before any agent dispatch, so it shows (with its files) at send time instead of once a thread has
 * started; the dispatch then only routes it. A failed save puts the text and files back, a failed dispatch keeps the
 * saved reply and says what did not happen.
 *
 * The sequence itself belongs to `replyMachine`; this runs one reply to its end for callers that only await the
 * outcome, and reports failures through the same view the machine writes.
 */
export const submitReply = async <File>(input: {
  readonly text: string
  readonly files: readonly File[]
  readonly save: (files: readonly File[]) => Promise<void>
  readonly dispatch: ReplyDispatch | null
  readonly view: ReplyView<File>
  readonly onAnswering?: (answering: boolean) => void
}): Promise<void> => {
  const actor = createActor(createReplyMachine<File>()).start()
  actor.send({
    type: 'SUBMIT',
    text: input.text,
    files: input.files,
    ports: {
      save: input.save,
      dispatch: input.dispatch,
      clear: input.view.clear,
      restore: input.view.restore,
      reportFailure: input.view.fail,
      onAnswering: input.onAnswering,
    },
  })
  await waitFor(actor, snapshot => snapshot.value === 'idle' || snapshot.value === 'failed', { timeout: SETTLE_TIMEOUT_MS })
  actor.stop()
}
