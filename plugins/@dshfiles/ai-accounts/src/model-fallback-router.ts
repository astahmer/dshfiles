import type { Distribution } from './account-pool.js'
import type { FallbackRoute } from './model-fallback-api.js'
import { ModelFallbackModel } from './model-fallback.js'
import type { ModelFallbackStore } from './model-fallback-store.js'

interface RequestRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
}

/** A fallback serving a thread, and the selection it stands in for. */
interface Standing {
  readonly route: FallbackRoute
  readonly from: FallbackRoute
}

interface TurnState {
  readonly turn: number
  readonly tried: Set<string>
  last: RequestRoute | undefined
  /** A family chain derived on the fly, so `bind` can find the route the candidates named. */
  derivedChain: readonly FallbackRoute[] | undefined
  /** A stalled stream put this turn on the stored chain outside Priority, so its retries keep the fallback. */
  stalled: boolean
}

const asRoute = (route: RequestRoute): FallbackRoute =>
  route.reasoningEffort === undefined
    ? { provider: route.provider, model: route.model }
    : { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort }

/**
 * Walks a thread's model fallback chain. It only runs under Priority distribution; a thread whose stored chain is
 * empty walks its provider family's sibling accounts instead (one rung per account), so a Codex or OpenCode Go
 * account fails over to its own siblings without any stored chain. Every other thread keeps the account-level
 * fail-over, and a kind that must never fall back (Claude) has no siblings to walk. With `stalledStreamFallback` on,
 * a stream that went silent walks the stored chain under any distribution.
 *
 * DSH fixes a step's model before its requests, so the Host moves the Session selection to the fallback for the
 * next step and continues the interrupted turn there; the picker names the fallback and later turns stay on it. The
 * router remembers which selection the fallback stands in for, so the thread can return to it (on request, or at
 * the next turn under the `next-turn` policy). A request that proposes any other route means the user picked again.
 */
export const createModelFallbackRouter = (deps: {
  readonly store: () => ModelFallbackStore | undefined
  readonly distribution: () => Distribution
  /** Whether a route can take a request now: an enabled, healthy account, or a provider this Host serves. */
  readonly available: (route: FallbackRoute, now: number) => boolean
  /**
   * The sibling accounts `provider` may fall over to, one rung each, in the order they should be tried.
   * `undefined` when this provider kind has no fallback family.
   */
  readonly siblings?: (input: { readonly provider: string; readonly model: string | undefined }) => readonly FallbackRoute[] | undefined
  /** Whether a stalled stream walks the stored chain outside Priority too. */
  readonly stalledStreamFallback?: () => boolean
  readonly onError: (message: string) => void
}) => {
  const standings = new Map<string, Standing | null>()
  const turns = new Map<string, TurnState>()

  const standingFor = (sessionId: string): Standing | undefined => {
    const cached = standings.get(sessionId)
    if (cached !== undefined) return cached ?? undefined
    const standing = deps.store()?.activeFor(sessionId) ?? null
    standings.set(sessionId, standing)
    return standing ?? undefined
  }

  const stand = (sessionId: string, standing: Standing | null): void => {
    standings.set(sessionId, standing)
    const store = deps.store()
    const write = standing === null ? store?.deactivate(sessionId) : store?.activate(sessionId, { route: standing.route, from: standing.from })
    void write?.catch(error => deps.onError(`model fallback storage write failed: ${String(error)}`))
  }

  /** Drop the fallback and answer the selection it stood in for, which the Host selects again. */
  const release = (sessionId: string): FallbackRoute | undefined => {
    const standing = standingFor(sessionId)
    if (standing === undefined) return undefined
    stand(sessionId, null)
    return standing.from
  }

  /** The stored chain when the thread has one, else the family siblings of the route now being sent. */
  const chainFor = (
    sessionId: string,
    current?: { readonly provider: string; readonly model: string | undefined },
    stalled = false,
  ): readonly FallbackRoute[] => {
    if (deps.distribution() !== 'priority') return stalled && deps.stalledStreamFallback?.() === true ? (deps.store()?.chainFor(sessionId) ?? []) : []
    const stored = deps.store()?.chainFor(sessionId) ?? []
    if (stored.length > 0 || current?.model === undefined || current.model === '') return stored
    return deps.siblings?.({ provider: current.provider, model: current.model }) ?? []
  }

  const turnFor = (sessionId: string, turn: number): TurnState => {
    const existing = turns.get(sessionId)
    if (existing?.turn === turn) return existing
    const fresh: TurnState = { turn, tried: new Set(), last: undefined, derivedChain: undefined, stalled: false }
    turns.set(sessionId, fresh)
    return fresh
  }

  return {
    /** Whether this thread fails over along its fallback chain instead of across compatible accounts. */
    walksChain: (sessionId: string): boolean => chainFor(sessionId).length > 0,

    /** Note the route a request goes out on; one other than the standing fallback means the user picked again. */
    observeRequest: (input: { readonly sessionId: string; readonly turn: number; readonly request: RequestRoute }): void => {
      turnFor(input.sessionId, input.turn).last = asRoute(input.request)
      const standing = standingFor(input.sessionId)
      if (standing !== undefined && !ModelFallbackModel.sameRoute(input.request, standing.route)) stand(input.sessionId, null)
    },

    /** The turn continuing a failed-over one walks on from the routes that turn already tried. */
    continueTurn: (input: { readonly sessionId: string; readonly turn: number }): void => {
      const state = turns.get(input.sessionId)
      if (state !== undefined && state.turn < input.turn) turns.set(input.sessionId, { ...state, turn: input.turn })
    },

    /** Ordered route keys the failing request may move to, or undefined when the thread walks accounts instead. */
    candidates: (input: {
      readonly sessionId: string
      readonly current: { readonly provider: string; readonly model: string | undefined }
      readonly now: number
      /** The request failed because its stream went silent. */
      readonly stalled?: boolean
    }): string[] | undefined => {
      const state = turns.get(input.sessionId)
      const stalled = input.stalled === true || state?.stalled === true
      const chain = chainFor(input.sessionId, { provider: input.current.provider, model: input.current.model }, stalled)
      if (chain.length === 0) return undefined
      if (state !== undefined) {
        state.derivedChain = chain
        state.stalled = stalled
      }
      const current = { provider: input.current.provider, model: input.current.model ?? '' }
      state?.tried.add(ModelFallbackModel.routeKey(current))
      return ModelFallbackModel.remainingFallbacks({
        chain,
        current,
        tried: state?.tried ?? new Set(),
        available: route => deps.available(route, input.now),
      }).map(ModelFallbackModel.routeKey)
    },

    bind: (input: { readonly sessionId: string; readonly to: string }): FallbackRoute | undefined => {
      const state = turns.get(input.sessionId)
      const chain = state?.derivedChain ?? chainFor(input.sessionId)
      const route = chain.find(candidate => ModelFallbackModel.routeKey(candidate) === input.to)
      if (route === undefined || state?.last === undefined) return undefined
      stand(input.sessionId, { route, from: standingFor(input.sessionId)?.from ?? asRoute(state.last) })
      return route
    },

    active: (sessionId: string): FallbackRoute | undefined => standingFor(sessionId)?.route,

    returnToSelection: release,

    /** At the end of a turn, the selection to restore under the `next-turn` policy. */
    turnEnded: (sessionId: string): FallbackRoute | undefined => (deps.store()?.returnPolicy() === 'next-turn' ? release(sessionId) : undefined),

    forget: (sessionId: string): void => {
      standings.delete(sessionId)
      turns.delete(sessionId)
    },
  }
}

export type ModelFallbackRouter = ReturnType<typeof createModelFallbackRouter>
