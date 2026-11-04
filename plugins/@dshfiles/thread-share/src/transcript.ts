import { homedir } from 'node:os'
import type { Api } from '@dshfiles/dshx/effect'
import type { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { Context, Effect, Layer, Schema } from 'effect'
import { redactText } from './redact.js'

/** session-controller's sessions API, called as this plugin: the only way this plugin reads a thread. */
export class ShareSessions extends Context.Service<ShareSessions, Api.TypedApiClient<(typeof sessionsApi)['methods']>>()(
  '@dshfiles/thread-share/ShareSessions',
) {}

/** The most messages session-controller returns per thread; a longer thread shows its latest ones. */
export const MAX_MESSAGES = 100

const FALLBACK_TITLE = 'Shared thread'

/** The thread could not be read: unknown, deleted, or session-controller is not running. */
export class ThreadUnreadable extends Schema.TaggedError<ThreadUnreadable>()(
  'ThreadUnreadable',
  { sessionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-share-thread-unreadable' },
) {
  override get message(): string {
    return `Thread ${this.sessionId} could not be read. Check the thread id (thread_share_list or the thread list), and that @dshfiles/session-controller is installed; restart DSH after installing it.`
  }
}

/** The thread list could not be read, so the share form has nothing to offer. */
export class ThreadListUnavailable extends Schema.TaggedError<ThreadListUnavailable>()(
  'ThreadListUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-share-thread-list-unavailable' },
) {
  override get message(): string {
    return 'The thread list could not be read. Check that @dshfiles/session-controller is installed, restart DSH after installing it, then reopen this section.'
  }
}

export interface ThreadTranscript {
  readonly title: string
  readonly entries: ReadonlyArray<{ readonly role: 'user' | 'assistant'; readonly text: string }>
  readonly truncated: boolean
  /** How many messages the redactor changed, for the span; never what it hid. */
  readonly redactedMessages: number
}

const make = Effect.gen(function* () {
  const sessions = yield* ShareSessions
  const home = homedir()

  const threadRow = (sessionId: string) =>
    sessions.list({ includeArchived: true, limit: 200 }).pipe(
      Effect.map(page => page.threads.find(thread => thread.sessionId === sessionId)),
      Effect.orElseSucceed(() => undefined),
    )

  /** User and assistant text only (no tool calls, no attachments, no system context), redacted for sharing. */
  const read = Effect.fn('thread share transcript read')(function* (sessionId: string) {
    const page = yield* sessions.messages({ sessionId, limit: MAX_MESSAGES }).pipe(Effect.mapError(cause => new ThreadUnreadable({ sessionId, cause })))
    const row = yield* threadRow(sessionId)
    const context = { workspace: row?.cwd, home }
    let redactedMessages = 0
    const entries = page.entries.map(entry => {
      const redacted = redactText(entry.text, context)
      if (redacted.rules.length > 0) redactedMessages += 1
      return { role: entry.role, text: redacted.text }
    })
    const title = redactText(row?.title?.trim() || FALLBACK_TITLE, context).text
    yield* Effect.annotateCurrentSpan({ 'dshx.thread_share.messages': entries.length, 'dshx.thread_share.redacted_messages': redactedMessages })
    const transcript: ThreadTranscript = { title, entries, truncated: page.truncated, redactedMessages }
    return transcript
  })

  const options = Effect.fn('thread share thread options')(function* () {
    const page = yield* sessions.list({ includeArchived: false, limit: 50 }).pipe(Effect.mapError(cause => new ThreadListUnavailable({ cause })))
    return page.threads.map(thread => ({ sessionId: thread.sessionId, title: thread.title?.trim() || FALLBACK_TITLE, updatedAt: thread.updatedAt }))
  })

  return ShareThreads.of({ read, options: options() })
})

/** Reads one thread for a share page, a snapshot or an export. */
export class ShareThreads extends Context.Service<
  ShareThreads,
  {
    readonly read: (sessionId: string) => Effect.Effect<ThreadTranscript, ThreadUnreadable>
    readonly options: Effect.Effect<ReadonlyArray<{ readonly sessionId: string; readonly title: string; readonly updatedAt: number }>, ThreadListUnavailable>
  }
>()('@dshfiles/thread-share/ShareThreads') {
  static readonly layer = Layer.effect(ShareThreads, make)
}
