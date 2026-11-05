import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { SharedJevKey } from '@dshfiles/credential-port/jev-key'
import { Llm } from '@dshfiles/dshx/effect/llm'
import { Jev, type JevCredential } from '@dshfiles/jev'
import { Clock, Context, Effect, FiberSet, Layer, Option, Redacted } from 'effect'
import { AiActivity } from './ai-activity.js'
import type { BacklogDetailResult } from './api.js'
import type { TriageOutcome } from './backfill.js'
import { BacklogSettingsTag, SharedJevSettingsTag } from './backlog-settings.js'
import { BacklogWriteFailed, LlmCompletionFailed, TriageUnconfigured } from './errors.js'
import { ReplyRouting, type ReplyRouteResult } from './reply-routing.js'
import type { BacklogSettings } from './settings.js'
import { BacklogStore } from './store.js'
import { ThreadLifecycle } from './thread-lifecycle.js'
import { BacklogTriage, type JevAsk, type TriageServices } from './triage.js'

const TYPESAFE_ENV_KEY = 'TYPESAFE_API_KEY'

/** The services one triage pass uses, read once from the settings at its start. */
export interface TriageSetup {
  readonly settings: BacklogSettings
  readonly services: TriageServices
}

/** The triage provider and model, and a completion on that route with triage's timeout and error. */
export interface TriageModel {
  readonly provider: string
  readonly model: string
  readonly complete: (request: {
    readonly system: string
    readonly input: string
    readonly maxTokens?: number | undefined
  }) => Effect.Effect<string, LlmCompletionFailed>
}

/**
 * Triage of backlog items with Jev and/or a cheap model, and Jev's other backlog questions (thread resolution, reply
 * routing). A service that is not configured is skipped; a failing one never fails the item.
 */
export class Triage extends Context.Service<
  Triage,
  {
    /** The services the current settings resolve to, or why neither Jev nor a model is usable. */
    readonly setup: Effect.Effect<TriageSetup, TriageUnconfigured>
    /** One pass on one item: a confident proposal applies as `system`, a hesitant one waits on the item. */
    readonly pass: (input: { readonly id: number; readonly setup: TriageSetup }) => Effect.Effect<TriageOutcome, BacklogWriteFailed>
    /** Triage one item now with the current settings; without services the item is returned unchanged. */
    readonly item: (id: number) => Effect.Effect<BacklogDetailResult, BacklogWriteFailed>
    /** Triage a new capture in the background when `autoTriage` is on: the capture answers at once. */
    readonly schedule: (id: number) => Effect.Effect<void>
    /** Suggest closing the open items a finished thread worked on when Jev reads its last reply as resolution. */
    readonly resolveThread: (input: { readonly sessionId: string; readonly reply: string }) => Effect.Effect<void, BacklogWriteFailed>
    /** Jev is on but no key resolves. */
    readonly jevNeedsSetup: Effect.Effect<boolean>
    readonly classifyReply: (text: string) => Effect.Effect<ReplyRouteResult>
    /** The configured cheap triage model, for other short completions such as a shipped summary; none when unset. */
    readonly model: Effect.Effect<Option.Option<TriageModel>>
  }
>()('@dshfiles/backlog/Triage') {
  static readonly layer = Layer.effect(
    Triage,
    Effect.gen(function* () {
      const store = yield* BacklogStore
      const settings = yield* BacklogSettingsTag
      const secrets = yield* SecretReferenceResolver
      const jev = yield* Jev
      const llm = yield* Llm
      const activity = yield* AiActivity
      const background = yield* FiberSet.make()

      // The one shared key (Settings › Tools & MCP › Jev) wins; this plugin's earlier key stays the fallback. Absent in
      // a composition without settings-shell, where only the earlier key and the environment apply.
      const shared = yield* Effect.serviceOption(SharedJevSettingsTag)
      const sharedKey = Option.match(shared, { onNone: () => Effect.succeed(''), onSome: service => Effect.map(service.get, value => value.jevSecret) })
      if (Option.isSome(shared)) {
        const legacy = (yield* settings.get).jevSecret
        yield* SharedJevKey.adopt(shared.value, legacy).pipe(
          Effect.tap(result =>
            result.kind === 'deferred'
              ? Effect.logWarning('backlog: the earlier Jev key stays in Backlog settings until the shared key can be written', result.cause)
              : Effect.void,
          ),
          Effect.forkScoped,
        )
      }

      const resolveCredential = (current: BacklogSettings) =>
        Effect.flatMap(sharedKey, sharedReference =>
          secrets.resolveWithLabel({
            referenceText: SharedJevKey.reference({ shared: sharedReference, legacy: current.jevSecret }),
            environmentValue: process.env[TYPESAFE_ENV_KEY],
            environmentVariableName: TYPESAFE_ENV_KEY,
          }),
        ).pipe(Effect.map(Option.map((resolved): JevCredential => ({ apiKey: Redacted.make(resolved.value), label: resolved.label }))))

      const credential = (current: BacklogSettings) =>
        current.jevEnabled
          ? resolveCredential(current).pipe(
              Effect.catch(error => Effect.as(Effect.logWarning('backlog: the Jev credential could not be resolved', error), Option.none<JevCredential>())),
            )
          : Effect.succeedNone

      const askWith =
        (key: JevCredential): JevAsk =>
        request =>
          Effect.map(
            jev.ask({ question: request.question, text: request.text.slice(0, 8_000), credential: key, source: 'backlog', timeout: '4 seconds' }),
            verdict => verdict.probability,
          )

      const completeWith =
        (current: BacklogSettings): TriageModel['complete'] =>
        request =>
          llm
            .complete({
              provider: current.triageProvider,
              model: current.triageModel,
              system: request.system,
              input: request.input,
              maxTokens: request.maxTokens ?? 512,
              purpose: 'compaction',
            })
            .pipe(
              Effect.timeout('30 seconds'),
              Effect.mapError(cause => new LlmCompletionFailed({ provider: current.triageProvider, model: current.triageModel, cause })),
            )

      const setup = Effect.gen(function* () {
        const current = yield* settings.get
        const key = yield* credential(current)
        const modelReady = current.triageProvider !== '' && current.triageModel !== ''
        if (Option.isNone(key) && !modelReady) return yield* new TriageUnconfigured({ reason: current.jevEnabled ? 'jev-key-missing' : 'off' })
        const services: TriageServices = {
          jev: Option.getOrUndefined(Option.map(key, askWith)),
          complete: modelReady ? completeWith(current) : undefined,
        }
        return { settings: current, services }
      }).pipe(Effect.withSpan('backlog triage setup'))

      const pass = Effect.fn('backlog triage pass')(function* (input: { readonly id: number; readonly setup: TriageSetup }) {
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.item_id': input.id })
        const triageInput = yield* store.triageInput(input.id)
        if (Option.isNone(triageInput)) return 'missing' as const
        const now = yield* Clock.currentTimeMillis
        const proposal = yield* activity.track(BacklogTriage.run({ ...triageInput.value, services: input.setup.services, now }))
        if (proposal === null) return 'unchanged' as const
        if (proposal.confidence >= input.setup.settings.applyThreshold) {
          yield* store.applyProposal({ id: input.id, proposal, actor: { kind: 'system' } })
          return 'applied' as const
        }
        yield* store.propose({ id: input.id, proposal })
        return 'proposed' as const
      })

      const item = Effect.fn('backlog triage item')(function* (id: number) {
        const configured = yield* Effect.option(setup)
        if (Option.isSome(configured)) yield* pass({ id, setup: configured.value })
        return yield* store.get(id)
      })

      const resolveThread = Effect.fn('backlog triage resolve thread')(function* (input: { readonly sessionId: string; readonly reply: string }) {
        const current = yield* settings.get
        if (current.threadResolution !== 'propose' || !current.jevEnabled || input.reply === '') return
        const linked = yield* store.referencing({ type: 'thread', target: input.sessionId })
        const details = yield* Effect.forEach(linked, summary => store.get(summary.id))
        const open = details.flatMap(detail => (detail.ok && ThreadLifecycle.openToResolution(detail.value.item) ? [detail.value.item] : []))
        if (open.length === 0) return
        const key = yield* credential(current)
        if (Option.isNone(key)) return
        const ask = askWith(key.value)
        const now = yield* Clock.currentTimeMillis
        for (const openItem of open) {
          const proposal = yield* activity.track(BacklogTriage.resolveThread({ item: openItem, reply: input.reply, jev: ask, now }))
          if (proposal !== null) yield* store.propose({ id: openItem.id, proposal })
        }
      })

      const jevNeedsSetup = Effect.gen(function* () {
        const current = yield* settings.get
        if (!current.jevEnabled) return false
        const resolved = yield* Effect.option(resolveCredential(current))
        return Option.isNone(Option.flatten(resolved))
      })

      const classifyReply = Effect.fn('backlog triage classify reply')(function* (text: string) {
        const current = yield* settings.get
        if (!current.smartThreadRouting) return { route: 'reply', confidence: 1, source: 'keywords' } satisfies ReplyRouteResult
        const key = yield* credential(current)
        const ask = Option.getOrUndefined(Option.map(key, askWith))
        return yield* activity.track(ReplyRouting.classify({ text, jev: ask, threshold: current.replyThreadThreshold }))
      })

      const schedule = Effect.fn('backlog triage schedule')(function* (id: number) {
        if (!(yield* settings.get).autoTriage) return
        yield* FiberSet.run(
          background,
          activity
            .track(item(id))
            .pipe(Effect.catch(error => Effect.flatMap(store.labelOf(id), label => Effect.logWarning(`backlog: triage of ${label} failed`, error)))),
          { startImmediately: true },
        )
      })

      const model = Effect.map(settings.get, current =>
        current.triageProvider === '' || current.triageModel === ''
          ? Option.none<TriageModel>()
          : Option.some({ provider: current.triageProvider, model: current.triageModel, complete: completeWith(current) }),
      )

      return Triage.of({ setup, pass, item, schedule, resolveThread, jevNeedsSetup, classifyReply, model })
    }),
  )
}
