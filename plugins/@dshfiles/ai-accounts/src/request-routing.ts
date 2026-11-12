import type { Agent, ModelSelection, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, LlmCallConfig, LlmFailure, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { DshxPlugin, HostContext, HostEvents } from '@dshfiles/dshx/effect'
import type { ThreadModelPolicy, ThreadModelSelection } from '@dshfiles/session-controller/thread-model-api'
import { Context, Effect, FiberMap, HashMap, Layer, Option, Ref, type Scope } from 'effect'
import { AccountPool, creditServedAttempt } from './account-pool.js'
import { AccountSettings } from './account-settings-service.js'
import type { AutomaticSelectionRefused } from './errors.js'
import { FailureRecoveryModel, type FailureRecovery } from './failure-recovery.js'
import type { FallbackRoute } from './model-fallback-api.js'
import { ModelFallbackModel } from './model-fallback.js'
import type { ModelFallbackRouter } from './model-fallback-router.js'
import type { Route } from './provider-routes.js'
import { RequestAccountRouting } from './request-account-routing.js'
import { RequestRoutingHooks } from './request-routing-promise.js'
import { RetryWait } from './retry-wait.js'
import { isRetryId, retryNotice } from './retry-notice.js'
import { ServingAccountModel, type ServingAccountService } from './serving-account.js'
import { explainSilentRejections } from './silent-rejection.js'
import { ThreadRequestPolicy } from './thread-request-policy.js'
// Types the `llm/retry` rows this plugin writes, so a fail-over shows in the turn like DSH's own retries.
import type { LlmRetryEventData, LlmRetryStartedEventData } from '@deepseek-ai/dsh-llm-retry'
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'llm/retry': LlmRetryEventData
    'llm/retry-started': LlmRetryStartedEventData
  }
}

/** The account a routed main request went out on; a fail-over moves `accountId` to the stand-in. */
interface ActiveRoute {
  readonly turn: number
  readonly step: number
  readonly provider: string
  readonly model: string
  readonly selectionRevision: number
  readonly accountId: string
}

/** The account routes and the recovery state the Host closure still owns, read by every routing decision. */
export interface RoutingWorld {
  readonly routes: () => ReadonlyMap<string, Route>
  readonly offersModel: (provider: string, model: string) => boolean
  readonly modelsCompatible: (sourceProvider: string, candidateProvider: string, model: string) => boolean
  readonly nativeProviders: () => readonly string[]
  /** Whether this account may not draw paid overage right now, when its reset lifts that, and the message a stopped turn carries. */
  readonly planBlockFor: (accountId: string) => { readonly blocked: boolean; readonly until: number | null; readonly message: string }
  readonly fallbackRouter: ModelFallbackRouter
  readonly recovery: FailureRecovery
  readonly servingAccount: ServingAccountService
  readonly recordQuotaFailure: (input: {
    readonly agent: Agent
    readonly accountId: string
    readonly autoRetry: boolean
    readonly failedSelection: { readonly provider: string; readonly model: string } | undefined
    readonly message: string
  }) => Effect.Effect<void>
  /** The guarded thread selection, or the legacy controller selection when no thread policy exists. */
  readonly selectModel: (input: {
    readonly agent: Agent
    readonly selection: ThreadModelSelection
    readonly expectedRevision: number
    readonly legacy: boolean
  }) => Effect.Effect<void, AutomaticSelectionRefused>
}

const nativeSelection = (route: FallbackRoute): ModelSelection =>
  route.reasoningEffort === undefined
    ? { provider: route.provider, model: route.model }
    : { provider: route.provider, model: route.model, reasoningEffort: ReasoningEffortId(route.reasoningEffort) }

const continuationText = (input: { readonly from: string; readonly to: string }): string =>
  `[ai-accounts fail-over] The previous request failed on ${input.from}, so this thread moved to ${input.to}. Continue the interrupted work from where it stopped. Check the recorded tool outcomes first and ask before repeating anything that may already have taken effect.`

/**
 * Request routing: which account each request goes out on, and what a failed request does next. The Cordis
 * waterfalls (`agent/request`, `agent/request-error`, `agent/request-messages`, `agent/turn-stopping`) run the
 * handlers below as Effects; `llm/stream` is synchronous, so it decides from the current `Ref` state. Per-agent
 * listeners live in one scope per agent, closed when the agent is disposed or the plugin unloads.
 *
 * DSH fixes each step's provider, model and effort before `agent/request`, which may not change them. A route change
 * is therefore an `agent.model.select()` for a later step: while the step's input is claimed (a selection naming a
 * provider with no adapter), or after a failed request (a fallback chain hop, which ends the step and continues the
 * turn on the fallback). Account fail-over keeps the step's route and moves only the wire account in `llm/stream`.
 */
export class RequestRouting extends Context.Service<
  RequestRouting,
  {
    /** The account one request goes out on, synchronously, from the routes chosen by `agent/request`. */
    readonly wireAccountFor: (options: GenerateOptions, world: Pick<RoutingWorld, 'routes' | 'modelsCompatible'>) => string
    /** Release a thread's retry wait after an explicit selection; never wakes or cancels Agent work. */
    readonly releaseRetryWait: (sessionId: string) => void
    readonly install: (world: RoutingWorld) => Effect.Effect<void, never, Scope.Scope>
  }
>()('@dshfiles/ai-accounts/RequestRouting') {
  static readonly make = Effect.gen(function* () {
    const pool = yield* AccountPool
    const settings = yield* AccountSettings
    const host = yield* HostContext
    const activeRoutes = yield* Ref.make(HashMap.empty<string, ActiveRoute>())
    const continuations = yield* Ref.make(HashMap.empty<string, UserMessage['id']>())
    const retryWait = yield* RetryWait

    const threadPolicyFor = (agent: Agent): ThreadModelPolicy | null =>
      host.ctx.sessionProjections.snapshot(agent.session, ['threadModelPolicy']).values.threadModelPolicy ?? null
    const prefersSelectedProvider = (agent: Agent, provider: string, model: string): boolean => {
      const policy = threadPolicyFor(agent)
      return policy?.preferSelectedProvider === true && policy.selection?.provider === provider && policy.selection.model === model
    }
    const activeRoute = (sessionId: string) => Effect.map(Ref.get(activeRoutes), routes => Option.getOrUndefined(HashMap.get(routes, sessionId)))
    const forgetRoute = (sessionId: string) => Ref.update(activeRoutes, routes => HashMap.remove(routes, sessionId))

    const wireAccountFor = (options: GenerateOptions, world: Pick<RoutingWorld, 'routes' | 'modelsCompatible'>): string =>
      RequestAccountRouting.wireAccountFor({
        provider: options.provider,
        model: options.model,
        purpose: options.purpose,
        conversationKey: options.sessionId,
        active: options.sessionId === undefined ? undefined : Option.getOrUndefined(HashMap.get(Ref.getUnsafe(activeRoutes), options.sessionId)),
        routes: world.routes(),
        pool: pool.view,
        modelsCompatible: world.modelsCompatible,
      })

    const install = Effect.fn('ai-accounts routing install')(function* (world: RoutingWorld) {
      const selectAutomaticModel = (agent: Agent, selection: ThreadModelSelection, expectedRevision: number) =>
        world.selectModel({ agent, selection, expectedRevision, legacy: threadPolicyFor(agent) === null })

      const preflightFor = (selection: Pick<ModelSelection, 'provider' | 'model'>) =>
        RequestAccountRouting.selectionPreflight({
          provider: selection.provider,
          model: selection.model,
          routes: world.routes(),
          nativeProviders: world.nativeProviders(),
          offersModel: world.offersModel,
          pool: pool.view,
        })

      const onClaimed = Effect.fn('ai-accounts inbox claimed')(function* (
        agent: Agent,
        claimed: { readonly messageId: UserMessage['id']; readonly turn: number },
      ) {
        const continuation = Option.getOrUndefined(HashMap.get(yield* Ref.get(continuations), agent.id))
        if (continuation === claimed.messageId) {
          yield* Ref.update(continuations, pending => HashMap.remove(pending, agent.id))
          world.fallbackRouter.continueTurn({ sessionId: agent.id, turn: claimed.turn })
        }
        const current = agent.model.current()
        if (current === undefined) return
        const preflight = preflightFor(current)
        if (preflight.kind !== 'route') return
        yield* Effect.logWarning(`ai-accounts: selection names provider "${current.provider}" with no adapter; moving the thread to ${preflight.provider}`)
        agent.model.select({ ...current, provider: preflight.provider })
      })

      const onAgentRequest = Effect.fn('ai-accounts agent request')(function* (
        agent: Agent,
        requestPolicy: ThreadRequestPolicy,
        position: { readonly turn: number; readonly step: number },
        request: LlmCallConfig,
      ) {
        const id = agent.id
        const routes = world.routes()
        if (prefersSelectedProvider(agent, request.provider, request.model)) world.fallbackRouter.returnToSelection(id)
        world.fallbackRouter.observeRequest({ sessionId: id, turn: position.turn, request })
        const preflight = preflightFor(request)
        if (preflight.kind === 'unserved') return yield* Effect.fail(RequestAccountRouting.unservedProviderError(request.provider))
        if (preflight.kind === 'route') {
          // Claiming the step's input normally moves such a selection; a step that claimed nothing still holds it.
          agent.model.select(
            request.reasoningEffort === undefined
              ? { provider: preflight.provider, model: request.model }
              : { provider: preflight.provider, model: request.model, reasoningEffort: request.reasoningEffort },
          )
          return yield* Effect.fail(
            new LlmError(
              `No adapter serves provider "${request.provider}" on this Host, so the thread now uses ${preflight.provider} for the same model. Send your message again.`,
              'NO_ADAPTER',
            ),
          )
        }
        if (!routes.has(request.provider)) {
          yield* forgetRoute(id)
          world.servingAccount.forget(id)
          return request
        }
        const recovering = (yield* settings.current).recovery
        // A fallback chain is the whole fail-over order, so its routes are not spread across accounts.
        const accountId = yield* pool.transact(view => {
          if (view.distribution() !== 'sticky') view.bindRoute(id, request.provider, request.provider)
          return RequestAccountRouting.selectTurnAccount({
            provider: request.provider,
            model: request.model,
            conversationKey: id,
            routes,
            pool: view,
            modelsCompatible: world.modelsCompatible,
            chainWalking: world.fallbackRouter.walksChain(id),
            preferSelectedProvider: prefersSelectedProvider(agent, request.provider, request.model),
            usageOrder: recovering.usageOrder,
            hiddenAccountIds: recovering.hiddenUsageAccounts,
          })
        })
        // Routing already skips such an account; reaching it means nothing else could serve the request, so stop here
        // instead of letting the provider bill overage the user refused.
        const planBlock = world.planBlockFor(accountId)
        if (planBlock.blocked) {
          const now = Date.now()
          if (planBlock.until !== null) pool.view.noteDeclaredReset(accountId, Math.max(planBlock.until - now, 1), now)
          yield* Effect.logInfo(`ai-accounts: ${planBlock.message}`)
          yield* world.recordQuotaFailure({
            agent,
            accountId,
            autoRetry: (yield* settings.current).quotaRetry.autoRetryDefault,
            failedSelection: { provider: request.provider, model: request.model },
            message: planBlock.message,
          })
          return yield* Effect.fail(new LlmError(planBlock.message, 'QUOTA_EXCEEDED'))
        }
        yield* Ref.update(activeRoutes, active =>
          HashMap.set(active, id, {
            turn: position.turn,
            step: position.step,
            provider: request.provider,
            model: request.model,
            accountId,
            selectionRevision: requestPolicy.revision,
          }),
        )
        return request
      })

      const onTurnStopping = Effect.fn('ai-accounts turn stopping')(function* (agent: Agent) {
        yield* forgetRoute(agent.id)
        world.servingAccount.clear(agent.id)
        const revision = threadPolicyFor(agent)?.revision ?? 0
        const restored = world.fallbackRouter.turnEnded(agent.id)
        if (restored === undefined) return
        yield* Effect.forkDetach(
          selectAutomaticModel(agent, ModelFallbackModel.selectionFor(restored), revision).pipe(
            Effect.catch(error =>
              Effect.logWarning(`ai-accounts: thread stayed on its fallback instead of returning to ${restored.provider}: ${String(error)}`),
            ),
          ),
        )
      })

      const onRequestError = Effect.fn('ai-accounts request error')(function* (
        agent: Agent,
        requestPolicy: ThreadRequestPolicy,
        failed: { readonly turn: number; readonly step: number; readonly provider: string; readonly failure: LlmFailure; readonly signal: AbortSignal },
        next: Effect.Effect<RequestErrorAction>,
      ) {
        const id = agent.id
        const { turn, step, provider, failure, signal } = failed
        const routes = world.routes()
        const surface = agent.session.deriveMessages()
        const active = yield* activeRoute(id)
        const routedAccountId = active?.turn === turn && active.step === step && active.provider === provider ? active.accountId : undefined
        const requestConfig = (): LlmCallConfig | undefined => agent.session.requestHeader()?.config
        const requestProvider = requestConfig()?.provider ?? provider
        const action = yield* pool.transact(() =>
          world.recovery.recover({
            conversationKey: id,
            turn,
            step,
            provider,
            requestProvider,
            ...(routedAccountId !== undefined && { routedAccountId }),
            model: requestConfig()?.model,
            failure,
            canShrink: FailureRecoveryModel.offloadResentImages(surface) !== surface,
          }),
        )
        if (action.kind === 'retry' && action.step.kind === 'failover' && routes.has(action.step.to) && routedAccountId !== undefined && active !== undefined) {
          const standIn = action.step.to
          yield* Ref.update(activeRoutes, current => HashMap.set(current, id, { ...active, accountId: standIn }))
        }
        if (action.kind === 'pass') return yield* next
        if (action.kind === 'give-up') {
          const decision = action.then === 'dsh' ? yield* next : undefined
          const config = requestConfig()
          const quotaRecovery = FailureRecoveryModel.quotaRecoveryFor({
            failureKind: action.failureKind,
            rescued: decision !== undefined,
            autoRetryDefault: (yield* settings.current).quotaRetry.autoRetryDefault,
          })
          if (quotaRecovery !== undefined) {
            yield* world.recordQuotaFailure({
              agent,
              accountId: action.account,
              autoRetry: quotaRecovery.autoRetry,
              failedSelection: config === undefined ? undefined : { provider: config.provider, model: config.model },
              message: failure.message,
            })
          }
          return decision
        }
        const userSelectedSinceRequest = (): boolean =>
          RequestAccountRouting.hasNewPreferredSelection({ requestRevision: active?.selectionRevision, current: threadPolicyFor(agent) })
        const retainUserSelection = pool.transact(view => {
          view.unbind(id)
          world.fallbackRouter.returnToSelection(id)
        })
        if (userSelectedSinceRequest()) {
          yield* retainUserSelection
          return signal.aborted ? undefined : { kind: 'retry' as const }
        }
        const retryId = action.retryId
        if (!isRetryId(retryId)) return yield* next
        const label = (target: string): string => {
          // Chain targets are `provider/model`; account ids never hold a slash.
          const slash = target.indexOf('/')
          const targetProvider = slash < 0 ? target : target.slice(0, slash)
          const name = routes.get(targetProvider)?.displayName ?? targetProvider
          return slash < 0 ? name : `${name} · ${target.slice(slash + 1)}`
        }
        const notice = retryNotice(action, { retryId, turn, step, provider: requestProvider, failure, model: requestConfig()?.model, label })
        yield* Effect.logInfo(`ai-accounts: ${notice.failure.message}`)
        agent.session.append('llm/retry', notice)
        const delayMs = action.step.kind === 'retry' || action.step.kind === 'wait' ? action.step.delayMs : 0
        if (!(yield* retryWait.wait(id, delayMs, signal))) return undefined
        if (userSelectedSinceRequest()) {
          yield* retainUserSelection
          return { kind: 'retry' as const }
        }
        if (action.step.kind === 'failover' && !world.routes().has(action.step.to)) {
          const config = requestConfig()
          return yield* continueOnFallback(agent, {
            expectedRevision: active?.selectionRevision ?? requestPolicy.revision,
            from: config === undefined ? label(requestProvider) : label(ModelFallbackModel.routeKey(config)),
            signal,
          })
        }
        agent.session.append('llm/retry-started', { retryId: notice.retryId, turn, step, retry: notice.retry })
        // The step keeps its route and `llm/stream` puts the stand-in account on the wire; later steps open on it.
        const followed = FailureRecoveryModel.selectionAfter({ action, config: requestConfig() })
        if (followed !== undefined) {
          yield* selectAutomaticModel(agent, followed, active?.selectionRevision ?? requestPolicy.revision).pipe(
            Effect.catch(() =>
              Effect.andThen(
                retainUserSelection,
                Effect.logWarning('ai-accounts: automatic retry kept the current thread selection because its guarded update was refused'),
              ),
            ),
          )
        }
        return { kind: 'retry' as const }
      })

      /**
       * A chain hop changes the route, which DSH only accepts for a later step: select the fallback now, let this step
       * fail, and once the turn has ended queue a continuation turn that opens on the fallback. A user who cancels,
       * queues work or picks another model in between keeps their choice and gets no continuation.
       */
      const continueOnFallback = Effect.fn('ai-accounts fallback continuation')(function* (
        agent: Agent,
        input: { readonly expectedRevision: number; readonly from: string; readonly signal: AbortSignal },
      ) {
        const route = world.fallbackRouter.active(agent.id)
        const policy = threadPolicyFor(agent)
        if (route === undefined || (policy !== null && policy.revision !== input.expectedRevision)) {
          yield* pool.transact(view => {
            view.unbind(agent.id)
            world.fallbackRouter.returnToSelection(agent.id)
          })
          return undefined
        }
        agent.model.select(nativeSelection(route))
        const message = createUserMessage({
          content: [{ type: 'text', text: continuationText({ from: input.from, to: `${world.routes().get(route.provider)?.displayName ?? route.provider} · ${route.model}` }) }],
          source: { kind: 'user' },
        })
        const resume = Effect.gen(function* () {
          yield* Effect.promise(() => agent.whenIdle())
          const current = agent.model.current()
          const userActed =
            input.signal.aborted ||
            agent.inbox.nextTurn.length > 0 ||
            agent.inbox.nextStep.length > 0 ||
            current === undefined ||
            !ModelFallbackModel.sameRoute(current, route)
          if (userActed) return
          yield* Ref.update(continuations, pending => HashMap.set(pending, agent.id, message.id))
          agent.followup(message)
        }).pipe(Effect.catchCause(cause => Effect.logWarning('ai-accounts: the turn stopped on its fallback without continuing', cause)))
        yield* Effect.forkDetach(resume)
        return undefined
      })

      const onRequestMessages = (agent: Agent, position: { readonly turn: number; readonly step: number }) =>
        world.recovery.shrinkActive(agent.id, position.turn, position.step)

      const agentScope = (agent: Agent) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const requestPolicy = new ThreadRequestPolicy(agent, () => threadPolicyFor(agent))
            const removeHooks = RequestRoutingHooks.register(agent, services, {
              claimed: claimed => onClaimed(agent, claimed),
              request: (position, proposed) => onAgentRequest(agent, requestPolicy, position, proposed),
              requestError: (failed, next) => onRequestError(agent, requestPolicy, failed, next),
              requestMessagesShrink: position => onRequestMessages(agent, position),
              turnStopping: () => onTurnStopping(agent),
            })
            return { requestPolicy, removeHooks }
          }),
          registration =>
            Effect.andThen(
              forgetRoute(agent.id),
              Effect.sync(() => {
                world.servingAccount.clear(agent.id)
                registration.requestPolicy.dispose()
                registration.removeHooks()
              }),
            ),
        )

      const services = yield* DshxPlugin.detachedContext<never>()
      const agentHooks = yield* FiberMap.make<string>()
      yield* HostEvents.on('agent/created', ({ agent }) =>
        FiberMap.run(agentHooks, agent.id, Effect.scoped(Effect.andThen(agentScope(agent), Effect.never)), { startImmediately: true }).pipe(Effect.asVoid),
      )
      yield* HostEvents.on('agent/disposed', ({ agent }) =>
        Effect.gen(function* () {
          yield* forgetRoute(agent.id)
          yield* Ref.update(continuations, pending => HashMap.remove(pending, agent.id))
          world.servingAccount.clear(agent.id)
          world.recovery.forget(agent.id)
          world.fallbackRouter.forget(agent.id)
          yield* FiberMap.remove(agentHooks, agent.id)
        }),
      )

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          host.ctx.on('llm/stream', (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
            // Credited only after the upstream answers, so a failed attempt is never "used",
            // and to the account a fail-over put on the wire rather than the chosen route.
            const routes = world.routes()
            if (!routes.has(options.provider)) return next()
            const accountId = wireAccountFor(options, world)
            const active = options.sessionId === undefined ? undefined : Option.getOrUndefined(HashMap.get(Ref.getUnsafe(activeRoutes), options.sessionId))
            // Only a routed main Agent step can claim attribution. Side purposes and native requests never can.
            const attempt = ServingAccountModel.startRequest(world.servingAccount, options, active, accountId, routes.get(accountId)?.kind)
            const chunks = attempt === undefined ? next() : ServingAccountModel.observe(next(), world.servingAccount, attempt)
            return explainSilentRejections(
              creditServedAttempt(chunks, {
                pool: {
                  noteServed: served => {
                    pool.view.noteServed(served)
                    world.recovery.noteServed(served)
                  },
                },
                accountId,
              }),
              options,
            )
          }),
        ),
        dispose => Effect.sync(dispose),
      )
    })

    return RequestRouting.of({
      wireAccountFor,
      releaseRetryWait: retryWait.release,
      install: world => Effect.provideService(install(world), HostContext, host),
    })
  })

  static readonly layer = Layer.effect(RequestRouting, RequestRouting.make).pipe(Layer.provide(RetryWait.layer))
}
