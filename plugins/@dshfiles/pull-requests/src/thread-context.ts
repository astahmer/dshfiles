import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-query'
import { HostContext } from '@dshfiles/dshx/effect'
import { Llm, LlmCallFailed } from '@dshfiles/dshx/effect/llm'
import { SessionId } from '@dshfiles/dshx/ids'
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
        const log = yield* reads.readSession(id.value).pipe(Effect.option)
        if (Option.isNone(log)) return EMPTY
        const events = log.value.events
        const header = events.findLast(event => event.type === 'request/header')
        const config = header?.type === 'request/header' ? header.data.header.config : undefined
        const route = config?.provider !== undefined && config.model !== undefined ? { provider: config.provider, model: config.model } : undefined
        const titled = yield* reads.readTitle(id.value).pipe(Effect.orElseSucceed(() => undefined))
        const documents = yield* reads
          .filterEvents(id.value, [{ kind: 'type', values: ['user/message', 'assistant/message'] }])
          .pipe(Effect.orElseSucceed(() => []))
        const messages = documents
          .filter(document => document.text.trim().length > 0)
          .slice(-MAX_MESSAGES)
          .map((document): ThreadMessage => ({ role: document.type === 'user/message' ? 'user' : 'assistant', text: document.text }))
        return { cwd: log.value.session.cwd, title: titled?.title ?? '', route, messages }
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
