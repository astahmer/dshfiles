import { errorMessage } from '@dshfiles/plugin-ui/query'

import type { AgentDispatchOutcome } from './agent-dispatch.js'

interface ReplyDispatch {
  readonly dispatch: () => Promise<AgentDispatchOutcome>
  readonly answerReply: () => Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>
  readonly smartReplyAnswers: boolean
}

interface ReplyView<File> {
  readonly clear: () => void
  readonly restore: (input: { readonly text: string; readonly files: readonly File[] }) => void
  readonly fail: (message: string) => void
}

const SAVED = 'Your reply was saved'

/**
 * Saves the reply before any agent dispatch, so it shows (with its files) at send time instead of once a thread has
 * started; the dispatch then only routes it. A failed save puts the text and files back, a failed dispatch keeps the
 * saved reply and says what did not happen.
 */
export const submitReply = async <File>(input: {
  readonly text: string
  readonly files: readonly File[]
  readonly save: (files: readonly File[]) => Promise<void>
  readonly dispatch: ReplyDispatch | null
  readonly view: ReplyView<File>
}): Promise<void> => {
  input.view.clear()
  try {
    await input.save(input.files)
  } catch (error) {
    input.view.restore({ text: input.text, files: input.files })
    input.view.fail(errorMessage(error, 'The reply was not saved.'))
    return
  }
  if (input.dispatch === null || input.text.trim() === '') return
  let outcome: AgentDispatchOutcome
  try {
    outcome = await input.dispatch.dispatch()
  } catch (error) {
    input.view.fail(`${SAVED}, but it was not sent to an agent: ${errorMessage(error, 'The dispatch failed.')}`)
    return
  }
  if (outcome.kind === 'failed') {
    input.view.fail(`${SAVED}, but no thread started: ${outcome.reason}`)
    return
  }
  if (outcome.kind !== 'skipped' || outcome.reason !== 'reply-only' || !input.dispatch.smartReplyAnswers || input.files.length > 0) return
  try {
    const answered = await input.dispatch.answerReply()
    if (!answered.ok) input.view.fail(`${SAVED}, but an AI answer could not be generated: ${answered.reason}`)
  } catch (error) {
    input.view.fail(`${SAVED}, but an AI answer could not be generated: ${errorMessage(error, 'Generation failed.')}`)
  }
}
