import { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { DshxPlugin } from '@dshfiles/dshx/effect'
import { hostService } from '@dshfiles/dshx/effect/host-context'
import { Llm } from '@dshfiles/dshx/effect/llm'
import { selectSummaryRoute, type SummarizerPolicy, type SummarizerRouteState, type SummaryEffort } from '@dshfiles/optmem-core/summary-routes'
import { Cache, Context, Duration, Effect, Layer, Option, Schema, Stream } from 'effect'

import { MemorySettingsTag } from './embedder.ts'
import type { MemorySettings } from './settings.ts'
import { SessionReads } from './session-reads-promise.ts'

export type DigestUsage = { readonly provider: string; readonly model: string; readonly input: number; readonly cacheRead: number; readonly output: number }

export class DigestModelFailed extends Schema.TaggedError<DigestModelFailed>()('DigestModelFailed', {
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.reason
  }
}

const effortOf = (effort: string): SummaryEffort | undefined =>
  effort === 'off' || effort === 'low' || effort === 'medium' || effort === 'high' ? effort : undefined

const policyOf = (settings: MemorySettings): SummarizerPolicy => ({
  override:
    settings.summarizerModel.length > 0
      ? { provider: settings.summarizerProvider, model: settings.summarizerModel, effort: effortOf(settings.summarizerEffort) }
      : undefined,
  cheapModels: settings.cheapModels.map(entry => ({ kind: entry.kind, models: entry.models, effort: effortOf(entry.effort) })),
  fallbacks: [],
})

/** One thread's route is kept a minute, so a burst of digests does not re-list provider models every call. */
const routeTtl = Duration.seconds(60)

/** One cheap-model call on the thread's route (reasoning off by default), for the few digests that need a model. */
export class Summarizer extends Context.Service<
  Summarizer,
  {
    readonly summarize: (request: {
      readonly conversationId: string
      readonly system: string
      readonly input: string
    }) => Effect.Effect<{ readonly text: string; readonly usage: DigestUsage | undefined }, DigestModelFailed>
  }
>()('@dshfiles/memory/Summarizer') {
  static readonly layer = Layer.effect(
    Summarizer,
    Effect.gen(function* () {
      const settings = yield* MemorySettingsTag
      const sessions = yield* SessionReads
      const llm = yield* Llm
      const models = Option.getOrUndefined(yield* Effect.option(hostService('llm')))
      const sessionProvider = yield* DshxPlugin.callback((conversationId: string) => sessions.providerOf(conversationId))

      // optmem-core's route selection is shared Promise code; its catalog callbacks come back into Effect here. The key
      // names the policy too, so a settings change re-selects instead of serving the old route for a minute.
      const select = (key: string) =>
        Effect.gen(function* () {
          const conversationId = key.slice(0, key.indexOf('\n'))
          const policy = policyOf(yield* settings.get)
          return yield* Effect.tryPromise({
            try: () =>
              selectSummaryRoute({
                policy,
                conversationId,
                catalog: {
                  sessionProvider,
                  // Cheap models match the provider id or its kind prefix (`opencode-go-pi` → `opencode-go`); AI Accounts' file is not read.
                  providerKind: async () => undefined,
                  models: async provider => ((await models?.listModels(provider).catch(() => [])) ?? []).map(model => model.id),
                },
              }),
            catch: cause => new DigestModelFailed({ reason: 'the digest route could not be resolved', cause }),
          })
        })
      const routes = yield* Cache.makeWith(select, {
        capacity: 256,
        timeToLive: exit => (exit._tag === 'Success' ? routeTtl : Duration.zero),
      })

      const attempt = (
        route: { readonly provider: string; readonly model: string },
        conversationId: string,
        request: { readonly system: string; readonly input: string },
        effort: SummaryEffort | undefined,
      ) =>
        Effect.gen(function* () {
          const assembler = new BlockAssembler()
          yield* Stream.runForEach(
            llm.stream({
              provider: route.provider,
              model: route.model,
              system: request.system,
              messages: [createUserMessage({ content: [{ type: 'text', text: request.input }], source: { kind: 'user' } })],
              maxTokens: 2_048,
              purpose: 'compaction',
              // OpenCode Go rejects calls without the per-conversation header the loop normally stamps; digests always name a session.
              sessionId: SessionId(conversationId),
              ...(effort !== undefined && { reasoningEffort: ReasoningEffortId(effort) }),
            }),
            chunk => Effect.sync(() => assembler.push(chunk)),
          ).pipe(
            Effect.timeoutOrElse({
              duration: '60 seconds',
              orElse: () => Effect.fail(new DigestModelFailed({ reason: 'the digest model did not answer within 60 s' })),
            }),
            Effect.catchTag('LlmCallFailed', cause => Effect.fail(new DigestModelFailed({ reason: cause.message, cause }))),
          )
          return assembler
        })

      const summarize = Effect.fn('memory digest summarize')(function* (request: {
        readonly conversationId: string
        readonly system: string
        readonly input: string
      }) {
        const policy = policyOf(yield* settings.get)
        const state: SummarizerRouteState = yield* Cache.get(routes, `${request.conversationId}\n${JSON.stringify(policy)}`)
        if (state.kind !== 'ready') return yield* new DigestModelFailed({ reason: state.kind === 'unavailable' ? state.reason : 'no route resolved' })
        yield* Effect.annotateCurrentSpan({ 'gen_ai.provider.name': state.route.provider, 'gen_ai.request.model': state.route.model })
        let effort = state.route.effort
        for (let tries = 0; tries < 2; tries++) {
          const assembler = yield* attempt(state.route, request.conversationId, request, effort)
          const finish = assembler.finish
          if (finish.kind === 'error' && finish.failure.code === 'UNSUPPORTED_REASONING_EFFORT' && effort !== undefined) {
            effort = undefined
            continue
          }
          if (finish.kind === 'error' || finish.kind === 'aborted') return yield* new DigestModelFailed({ reason: finish.failure.message })
          const text = assembler
            .blocks()
            .flatMap(block => (block.type === 'text' ? [block.text] : []))
            .join('')
            .trim()
          if (text.length === 0) return yield* new DigestModelFailed({ reason: `the digest model returned no text (${finish.kind})` })
          const tokens = assembler.usage
          const usage: DigestUsage | undefined =
            tokens === undefined
              ? undefined
              : {
                  provider: state.route.provider,
                  model: state.route.model,
                  input: tokens.inputTokens,
                  cacheRead: tokens.cacheReadTokens ?? 0,
                  output: tokens.outputTokens,
                }
          return { text, usage }
        }
        return yield* new DigestModelFailed({ reason: 'the digest route rejected every reasoning effort' })
      })

      return Summarizer.of({ summarize })
    }),
  )
}
