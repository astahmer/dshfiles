import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-llm'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import { HostContext } from '@dshfiles/dshx/effect'
import { Llm, LlmCallFailed } from '@dshfiles/dshx/effect/llm'
import { SessionId } from '@dshfiles/dshx/ids'
import { recentLogEvents } from '@dshfiles/session-log-window'
import { Context, Effect, Layer, Option, Schema } from 'effect'

import { sessionQueryReads } from './session-query-promise.js'

export interface ThreadMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

export interface ThreadSnapshot {
  readonly cwd: string | undefined
  readonly title: string
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
  readonly signal: AbortSignal
}

/**
 * The route and newest messages of one stored thread from the newest window of its log, or `undefined` when only the
 * whole log can serve the read exactly. A conversation's last messages and its last request envelope both sit near the
 * end of the log, so the window that holds its newest events holds both.
 */
const readBoundedThread = async (input: BoundedReadInput): Promise<{ readonly cwd: string | undefined; readonly route: ThreadSnapshot['route']; readonly messages: readonly ThreadMessage[] } | undefined> => {
  for (let keep = MAX_MESSAGES * 2; ; keep *= 2) {
    const recent = await recentLogEvents({ ctx: input.ctx, sessionId: input.sessionId, signal: input.signal, matches: isThreadEvent, keep })
    if (recent === undefined) return undefined
    const messages = recent.events
      .filter(event => MESSAGE_TYPES.has(event.type))
      .flatMap((event): readonly ThreadMessage[] => {
        const text = extractSessionEventText(event)
        return text.trim().length === 0 ? [] : [{ role: event.type === 'user/message' ? 'user' : 'assistant', text }]
      })
      .slice(-MAX_MESSAGES)
    if (messages.length >= MAX_MESSAGES || recent.complete) return { cwd: recent.session.cwd, route: routeOf(recent.events), messages }
  }
}

/** The route the thread's last model request used, from the last request envelope in the window. */
const routeOf = (events: readonly SessionEvent[]): ThreadSnapshot['route'] => {
  const header = events.findLast(event => event.type === 'request/header')
  if (header?.type !== 'request/header') return undefined
  const config = header.data.header.config
  return config?.provider !== undefined && config.model !== undefined ? { provider: config.provider, model: config.model } : undefined
}

const EMPTY: ThreadSnapshot = { cwd: undefined, title: '', route: undefined, messages: [] }

/** What the create flow reads about a thread, and the one model call that drafts its pull request. */
export class ThreadContext extends Context.Service<
  ThreadContext,
  {
    readonly read: (sessionId: string) => Effect.Effect<ThreadSnapshot>
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

      const read = Effect.fn('pull-requests thread read')(function* (sessionId: string) {
        const id = sessionIdOf(sessionId)
        // Looked up per read: session query is optional and may register after this plugin.
        const sessionQuery = ctx.get('sessionQuery')
        if (Option.isNone(id) || sessionQuery === undefined) return EMPTY
        const reads = sessionQueryReads(sessionQuery)
        const titled = yield* reads.readTitle(id.value).pipe(Effect.orElseSucceed(() => undefined))
        // A window of the log's newest events serves a thread's closing conversation; only a log it cannot prove reads
        // whole, and that read keeps the earlier shape of this answer.
        const bounded = yield* Effect.tryPromise(() => readBoundedThread({ ctx, sessionId: id.value, signal: new AbortController().signal })).pipe(
          Effect.orElseSucceed(() => undefined),
        )
        if (bounded !== undefined) return { cwd: bounded.cwd, title: titled?.title ?? '', route: bounded.route, messages: bounded.messages }
        const log = yield* reads.readSession(id.value).pipe(Effect.option)
        if (Option.isNone(log)) return EMPTY
        const events = log.value.events
        const documents = yield* reads
          .filterEvents(id.value, [{ kind: 'type', values: ['user/message', 'assistant/message'] }])
          .pipe(Effect.orElseSucceed(() => []))
        const messages = documents
          .filter(document => document.text.trim().length > 0)
          .slice(-MAX_MESSAGES)
          .map((document): ThreadMessage => ({ role: document.type === 'user/message' ? 'user' : 'assistant', text: document.text }))
        return { cwd: log.value.session.cwd, title: titled?.title ?? '', route: routeOf(events), messages }
      })

      return ThreadContext.of({
        read: sessionId => read(sessionId).pipe(Effect.orElseSucceed(() => EMPTY)),
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
