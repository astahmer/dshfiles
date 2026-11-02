import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, LlmCallConfig, LlmFailure, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { DshxPlugin, HostContext, HostEvents } from '@dshfiles/dshx/effect'
import { threadModelPolicySchema, type ThreadModelPolicy, type ThreadModelSelection } from '@dshfiles/session-controller/thread-model-api'
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

const chainSelection = (route: FallbackRoute | undefined) => (route === undefined ? undefined : ModelFallbackModel.selectionFor(route))

/**
 * Request routing: which account each request goes out on, and what a failed request does next. The Cordis
 * waterfalls (`agent/request`, `agent/request-error`, `agent/request-messages`, `agent/turn-stopping`) run the
 * handlers below as Effects; `llm/stream` is synchronous, so it decides from the current `Ref` state. Per-agent
 * listeners live in one scope per agent, closed when the agent is disposed or the plugin unloads.
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
    const retryWait = yield* RetryWait

    const threadPolicyFor = (agent: Agent): ThreadModelPolicy | null => {
      const policy = threadModelPolicySchema.safeParse(host.ctx.sessionProjections.stateOf(agent.session, 'threadModelPolicy'))
      return policy.success ? policy.data : null
    }
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

      const onAgentRequest = Effect.fn('ai-accounts agent request')(function* (
        agent: Agent,
        requestPolicy: ThreadRequestPolicy,
        position: { readonly turn: number; readonly step: number },
        proposed: LlmCallConfig,
      ) {
        const id = agent.id
        const routes = world.routes()
        if (prefersSelectedProvider(agent, proposed.provider, proposed.model)) world.fallbackRouter.returnToSelection(id)
        const fallback = world.fallbackRouter.routeRequest({ sessionId: id, turn: position.turn, request: proposed })
        let request: LlmCallConfig = proposed
        if (fallback !== undefined) {
          // The proposed effort belongs to the route the fallback replaces.
          const { reasoningEffort: _replacedEffort, ...proposedRest } = proposed
          request = { ...proposedRest, provider: fallback.provider, model: fallback.model }
          if (fallback.reasoningEffort !== undefined) request = { ...request, reasoningEffort: ReasoningEffortId(fallback.reasoningEffort) }
        }
        const preflight = RequestAccountRouting.selectionPreflight({
          provider: request.provider,
          model: request.model,
          routes,
          nativeProviders: world.nativeProviders(),
          offersModel: world.offersModel,
          pool: pool.view,
        })
        if (preflight.kind === 'unserved') return yield* Effect.fail(RequestAccountRouting.unservedProviderError(request.provider))
        if (preflight.kind === 'route') {
          yield* Effect.logWarning(
            `ai-accounts: selection names provider "${request.provider}" with no adapter; serving this request from ${preflight.provider}`,
          )
          request = { ...request, provider: preflight.provider }
        }
        if (!routes.has(request.provider)) {
          yield* forgetRoute(id)
          world.servingAccount.forget(id)
          return request
        }
        const recoverySettings = (yield* settings.current).recovery
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
            usageOrder: recoverySettings.usageOrder,
            hiddenAccountIds: recoverySettings.hiddenUsageAccounts,
          })
        })
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
        const notice = retryNotice(action, {
          retryId,
          turn,
          step,
          provider: requestProvider,
          failure,
          label: target => {
            // Chain targets are `provider/model`; account ids never hold a slash.
            const slash = target.indexOf('/')
            const targetProvider = slash < 0 ? target : target.slice(0, slash)
            const name = routes.get(targetProvider)?.displayName ?? targetProvider
            return slash < 0 ? name : `${name} · ${target.slice(slash + 1)}`
          },
        })
        yield* Effect.logInfo(`ai-accounts: ${notice.failure.message}`)
        agent.session.append('llm/retry', notice)
        const delayMs = action.step.kind === 'retry' || action.step.kind === 'wait' ? action.step.delayMs : 0
        if (!(yield* retryWait.wait(id, delayMs, signal))) return undefined
        if (userSelectedSinceRequest()) {
          yield* retainUserSelection
          return { kind: 'retry' as const }
        }
        agent.session.append('llm/retry-started', { retryId: notice.retryId, turn, step, retry: notice.retry })
        // The retry re-reads the Session selection, so it opens on the stand-in route and the picker follows.
        const followed =
          action.step.kind === 'failover' && !world.routes().has(action.step.to)
            ? chainSelection(world.fallbackRouter.active(id))
            : FailureRecoveryModel.selectionAfter({ action, config: requestConfig() })
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

      const onRequestMessages = (agent: Agent, position: { readonly turn: number; readonly step: number }) =>
        world.recovery.shrinkActive(agent.id, position.turn, position.step)

      const agentScope = (agent: Agent) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const requestPolicy = new ThreadRequestPolicy(agent, () => threadPolicyFor(agent))
            const removeHooks = RequestRoutingHooks.register(agent, services, {
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
