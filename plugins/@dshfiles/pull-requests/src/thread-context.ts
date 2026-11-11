import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-llm'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import { HostContext } from '@dshfiles/dshx/effect'
import { Llm, LlmCallFailed } from '@dshfiles/dshx/effect/llm'
import { SessionId } from '@dshfiles/dshx/ids'
import { Context, Effect, Layer, Option, Schema } from 'effect'

import { readRecentLogEvents } from './session-log-promise.js'
import { statStoredSession } from './session-persistence-promise.js'
import { sessionQueryReads } from './session-query-promise.js'

export interface ThreadMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

/** What drafting a pull request reads of a thread's conversation; only a draft the model writes needs it. */
export interface ThreadConversation {
  /** The route the thread's own model requests used last. */
  readonly route: { readonly provider: string; readonly model: string } | undefined
  readonly messages: readonly ThreadMessage[]
}

export interface ThreadCompletion {
  readonly provider: string
  readonly model: string
  readonly sessionId: string
  readonly system: string
  readonly input: string
}

const sessionIdOf = Schema.decodeUnknownOption(SessionId)
const MAX_MESSAGES = 40
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])
const THREAD_EVENT_TYPES = new Set(['user/message', 'assistant/message', 'request/header'])

const isThreadEvent = (event: SessionEvent): boolean => THREAD_EVENT_TYPES.has(event.type)

/** The Host context a bounded read needs, as the Session Query service cannot hand one out. */
interface BoundedReadInput {
  readonly ctx: CordisContext
  readonly sessionId: SessionId
}

/**
 * The route and newest messages of one stored thread from the newest window of its log, or `undefined` when only the
 * whole log can serve the read exactly. A conversation's last messages and its last request envelope both sit near the
 * end of the log, so the window that holds its newest events holds both.
 */
const readBoundedThread = Effect.fnUntraced(function* (input: BoundedReadInput) {
  for (let keep = MAX_MESSAGES * 2; ; keep *= 2) {
    const recent = yield* readRecentLogEvents({ ctx: input.ctx, sessionId: input.sessionId, matches: isThreadEvent, keep })
    if (recent === undefined) return undefined
    const messages = recent.events
      .filter(event => MESSAGE_TYPES.has(event.type))
      .flatMap((event): readonly ThreadMessage[] => {
        const text = extractSessionEventText(event)
        return text.trim().length === 0 ? [] : [{ role: event.type === 'user/message' ? 'user' : 'assistant', text }]
      })
      .slice(-MAX_MESSAGES)
    // The newest request envelope in the window is the thread's last route; a window that covers the log start is the
    // only one whose silence about a route proves there is none.
    const route = routeOf(recent.events)
    if (route !== undefined && (messages.length >= MAX_MESSAGES || recent.complete)) return { route, messages }
    if (recent.complete) return { route, messages }
  }
})

/** The route the thread's last model request used, from the last request envelope in the window. */
const routeOf = (events: readonly SessionEvent[]): ThreadConversation['route'] => {
  const header = events.findLast(event => event.type === 'request/header')
  if (header?.type !== 'request/header') return undefined
  const config = header.data.header.config
  return config?.provider !== undefined && config.model !== undefined ? { provider: config.provider, model: config.model } : undefined
}

const EMPTY: ThreadConversation = { route: undefined, messages: [] }

/**
 * What the create flow reads about a thread, each piece on its own so a caller pays only for what it uses: the
 * directory from the stored header, the title from the title index, and the conversation from a window of the log.
 */
export class ThreadContext extends Context.Service<
  ThreadContext,
  {
    /** The thread's working directory from its stored header; never decodes the log. */
    readonly cwdOf: (sessionId: string) => Effect.Effect<string | undefined>
    readonly titleOf: (sessionId: string) => Effect.Effect<string>
    /** The newest messages and the last model route: a bounded read of the log's newest events. */
    readonly conversation: (sessionId: string) => Effect.Effect<ThreadConversation>
    /** False when the Host has no language-model service. */
    readonly canGenerate: boolean
    readonly complete: (request: ThreadCompletion) => Effect.Effect<string, LlmCallFailed>
  }
>()('@dshfiles/pull-requests/ThreadContext') {
  static readonly layer = Layer.effect(
    ThreadContext,
    Effect.gen(function* () {
      const ctx = (yield* HostContext).ctx
      const llm = yield* Layer.build(Llm.layer).pipe(
        Effect.map(services => Context.get(services, Llm)),
        Effect.option,
      )

      const cwdOf = Effect.fn('pull-requests thread cwd')(function* (sessionId: string) {
        const id = sessionIdOf(sessionId)
        if (Option.isNone(id)) return undefined
        const stat = yield* statStoredSession(ctx, id.value)
        return stat?.header.cwd
      })

      const titleOf = Effect.fn('pull-requests thread title')(function* (sessionId: string) {
        const id = sessionIdOf(sessionId)
        // Looked up per read: session query is optional and may register after this plugin.
        const sessionQuery = ctx.get('sessionQuery')
        if (Option.isNone(id) || sessionQuery === undefined) return ''
        return (yield* sessionQueryReads(sessionQuery).readTitle(id.value))?.title ?? ''
      })

      const conversation = Effect.fn('pull-requests thread conversation')(function* (sessionId: string) {
        const id = sessionIdOf(sessionId)
        const sessionQuery = ctx.get('sessionQuery')
        if (Option.isNone(id) || sessionQuery === undefined) return EMPTY
        const reads = sessionQueryReads(sessionQuery)
        // A window of the log's newest events serves a thread's closing conversation; only a log it cannot prove reads
        // whole, and that read keeps the earlier shape of this answer.
        const bounded = yield* readBoundedThread({ ctx, sessionId: id.value }).pipe(Effect.orElseSucceed(() => undefined))
        if (bounded !== undefined) return bounded
        const log = yield* reads.readSession(id.value).pipe(Effect.option)
        if (Option.isNone(log)) return EMPTY
        const documents = yield* reads
          .filterEvents(id.value, [{ kind: 'type', values: ['user/message', 'assistant/message'] }])
          .pipe(Effect.orElseSucceed(() => []))
        const messages = documents
          .filter(document => document.text.trim().length > 0)
          .slice(-MAX_MESSAGES)
          .map((document): ThreadMessage => ({ role: document.type === 'user/message' ? 'user' : 'assistant', text: document.text }))
        return { route: routeOf(log.value.events), messages }
      })

      return ThreadContext.of({
        cwdOf: sessionId => cwdOf(sessionId).pipe(Effect.orElseSucceed(() => undefined)),
        titleOf: sessionId => titleOf(sessionId).pipe(Effect.orElseSucceed(() => '')),
        conversation: sessionId => conversation(sessionId).pipe(Effect.orElseSucceed(() => EMPTY)),
        canGenerate: Option.isSome(llm),
        complete: request =>
          Option.match(llm, {
            onNone: () =>
              Effect.fail(new LlmCallFailed({ provider: request.provider, model: request.model, reason: 'the Host has no language-model service' })),
            onSome: service =>
              Option.match(sessionIdOf(request.sessionId), {
                onNone: () => service.complete({ ...request, sessionId: undefined, maxTokens: 1_024, purpose: 'compaction' }),
                onSome: sessionId => service.complete({ ...request, sessionId, maxTokens: 1_024, purpose: 'compaction' }),
              }),
          }),
      })
    }),
  )
}
