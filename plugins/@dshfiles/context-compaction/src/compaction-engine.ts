import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction'
import { BasicCompactionEngine, type ResolvedConfig } from '@deepseek-ai/dsh-compaction-basic'
import { CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'
import { withSpan } from '@dshfiles/dshx/tracing'
import { isDeepStrictEqual } from 'node:util'
import { compactionSpec, type CompactionSpec } from './compaction-threshold.js'
import { isProviderContextOverflow } from './context-overflow.js'
import { withLoadedSkills, type LoadedSkillsMode } from './loaded-skills.js'
import { selectCompactableRange, summarizationInputFor, type SummarizationInput, type SurfaceRange } from './surface-range.js'

type SummaryResult = Awaited<ReturnType<BasicCompactionEngine['summarize']>>

export interface SummaryRequest {
  readonly input: SummarizationInput
  readonly agent: Agent
  readonly config: ResolvedConfig
  readonly signal: AbortSignal | undefined
  /** The stock engine's single summary request. */
  readonly base: (input: SummarizationInput, signal?: AbortSignal) => Promise<SummaryResult>
}

export interface BackgroundSummaryPolicy {
  readonly enabled: boolean
  /** Fraction of the compaction threshold at which a thread's summary starts in the background. */
  readonly startRatio: number
}

/** A summary prepared ahead of the threshold for one exact surface span. */
interface PreparedSummary {
  readonly generation: number
  readonly range: SurfaceRange
  readonly input: SummarizationInput
  /** Null when the background request failed; the automatic compaction then summarizes as usual. */
  readonly result: Promise<SummaryResult | null>
}

interface Pressure {
  readonly spec: CompactionSpec
  readonly measurement: TokenMeasurement
}

/** A pressure compaction that failed for a reason a retry cannot fix, until the surface or the request prefix changes. */
interface StalledCompaction {
  readonly generation: number
  readonly request: string
}

const routeOf = (session: Session) => {
  const config = session.requestHeader()?.config
  if (config === undefined || config.provider === '' || config.model === '') return undefined
  return { provider: config.provider, model: config.model }
}

const policyFor = (config: ResolvedConfig, route: { readonly provider: string; readonly model: string }) => {
  const override = config.modelPolicies.find(policy => policy.provider === route.provider && policy.model === route.model)
  return {
    compactionRetries: override?.compactionRetries ?? config.compactionRetries,
    maxOverflowRetries: override?.maxOverflowRetries ?? config.maxOverflowRetries,
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The route and tool catalog every summary request replays: a change can make a refused request fit. */
const requestKeyOf = (session: Session) => {
  const header = session.requestHeader()
  return JSON.stringify([header?.config.provider, header?.config.model, header?.tools?.map(tool => tool.name)])
}

/**
 * The stock engine with four additions, all through its public, dynamically dispatched methods:
 * every summary request is bounded by `summarize` (split, reduced, shortened); a pressure compaction can apply a
 * summary prepared in the background instead of waiting for one; a pressure failure that a retry cannot fix waits for
 * the history or request prefix to change instead of repeating at every step; and a provider overflow the core does
 * not code as `CONTEXT_WINDOW_EXCEEDED` still gets the overflow compaction and retry.
 */
export const compactionEngine = (options: {
  readonly summarize: (request: SummaryRequest) => Promise<SummaryResult>
  readonly onConfig: (config: ResolvedConfig) => void
  readonly background: BackgroundSummaryPolicy
  /**
   * True for a summary failure that the same surface and route reproduce on every attempt (a request that cannot fit
   * the budget, a route without image pricing). The pressure trigger then waits for the surface or the route to change
   * instead of failing again at every step.
   */
  readonly isPersistentFailure: (error: unknown) => boolean
  /** What each checkpoint keeps of the skills loaded in the span it replaces. */
  readonly loadedSkills: LoadedSkillsMode
  /** Aborted when the plugin unloads: stops background summaries still in flight. */
  readonly signal: AbortSignal
}) =>
  class ContextCompactionEngine extends BasicCompactionEngine {
    private readonly prepared = new WeakMap<Session, PreparedSummary>()
    private readonly preparing = new WeakSet<Session>()
    private readonly uncodedOverflowRetries = new WeakMap<Agent, number>()
    private readonly stalled = new WeakMap<Session, StalledCompaction>()

    constructor(...args: ConstructorParameters<typeof BasicCompactionEngine>) {
      super(...args)
      options.onConfig(this.config)
      if (!this.config.auto) return
      if (options.background.enabled)
        this.ctx.on('agent/pre-step', ({ agent }, next) => {
          void this.prepareInBackground(agent)
          return next()
        })
      this.ctx.on('agent/status', ({ agent, status }) => {
        if (status === 'idle') this.uncodedOverflowRetries.delete(agent)
      })
      this.ctx.on('agent/request-error', async ({ agent, failure, signal }, next) => {
        if (failure.code === CONTEXT_WINDOW_EXCEEDED_CODE || signal.aborted || !isProviderContextOverflow(failure)) return next()
        const route = routeOf(agent.session)
        if (route === undefined) return next()
        const retries = this.uncodedOverflowRetries.get(agent) ?? 0
        if (retries >= policyFor(this.config, route).maxOverflowRetries) return next()
        const generation = agent.session.surface.replaceGeneration
        try {
          await this.compactIfNeeded(agent, 'context-overflow', signal)
        } catch (error: unknown) {
          if (signal.aborted || agent.session.surface.replaceGeneration <= generation) {
            this.ctx.logger.warn(`context-overflow compaction failed: ${errorText(error)}; preserving the original request error`)
            return next()
          }
        }
        if (signal.aborted || agent.session.surface.replaceGeneration <= generation) return next()
        this.uncodedOverflowRetries.set(agent, retries + 1)
        return { kind: 'retry' }
      })
    }

    protected override async summarize(input: SummarizationInput, agent: Agent, signal?: AbortSignal): Promise<SummaryResult> {
      const result = await this.summarizeSpan(input, agent, signal)
      return { ...result, summary: withLoadedSkills({ summary: result.summary, messages: input.messages, mode: options.loadedSkills }) }
    }

    private async summarizeSpan(input: SummarizationInput, agent: Agent, signal: AbortSignal | undefined): Promise<SummaryResult> {
      const prepared = this.prepared.get(agent.session)
      if (prepared !== undefined && isDeepStrictEqual(prepared.input, input)) {
        this.prepared.delete(agent.session)
        const result = await prepared.result
        if (result !== null) return result
      }
      return this.freshSummary(input, agent, signal)
    }

    override async compactIfNeeded(agent: Agent, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null> {
      if (trigger !== 'pressure') return super.compactIfNeeded(agent, trigger, signal)
      const session = agent.session
      const stalled = this.stalled.get(session)
      if (stalled !== undefined && stalled.generation === session.surface.replaceGeneration && stalled.request === requestKeyOf(session)) return null
      this.stalled.delete(session)
      try {
        return await this.compactForPressure(agent, signal)
      } catch (error: unknown) {
        if (!signal.aborted && options.isPersistentFailure(error))
          this.stalled.set(session, { generation: session.surface.replaceGeneration, request: requestKeyOf(session) })
        throw error
      }
    }

    private async compactForPressure(agent: Agent, signal: AbortSignal): Promise<CompactionResult | null> {
      const pressure = await this.pressure(agent, signal)
      if (pressure === null) return super.compactIfNeeded(agent, 'pressure', signal)
      if (pressure.measurement.totalTokens < pressure.spec.thresholdTokens) return null
      const applied = await this.applyPrepared(agent, signal)
      if (applied !== null && this.ctx.tokenMeter.measure(agent.session).totalTokens < pressure.spec.thresholdTokens) return applied
      const rest = pressure.spec.headroomApplied
        ? await super.compactIfNeeded(agent, 'pressure', signal)
        : await this.compactWithoutHeadroom(agent, pressure.spec, signal)
      return rest ?? applied
    }

    private freshSummary(input: SummarizationInput, agent: Agent, signal: AbortSignal | undefined): Promise<SummaryResult> {
      return options.summarize({
        input,
        agent,
        config: this.config,
        signal,
        base: (candidate, candidateSignal) => super.summarize(candidate, agent, candidateSignal),
      })
    }

    /** The route's trigger and retained tail, priced as the stock engine prices them; null without a routed window. */
    private async pressure(agent: Agent, signal: AbortSignal): Promise<Pressure | null> {
      const route = routeOf(agent.session)
      if (route === undefined) return null
      const info = await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal)
      const contextWindow = info.context?.contextWindow
      if (contextWindow === undefined) return null
      const spec = compactionSpec({
        config: this.config,
        route,
        contextWindow,
        reservedCompletionTokens: agent.session.requestHeader()?.config.maxTokens ?? info.defaultMaxTokens ?? 0,
      })
      return spec === null ? null : { spec, measurement: this.ctx.tokenMeter.measure(agent.session) }
    }

    /**
     * Start one summary of the span the next pressure compaction would replace, once a thread passes `startRatio` of
     * its threshold. It runs beside the turn: nothing waits for it, and it never appends to the Session. One per
     * surface generation, so a failed or stale summary is not retried until a compaction rewrites the surface.
     */
    private async prepareInBackground(agent: Agent): Promise<void> {
      const session = agent.session
      const generation = session.surface.replaceGeneration
      if (options.signal.aborted || this.preparing.has(session) || this.prepared.get(session)?.generation === generation) return
      this.preparing.add(session)
      try {
        await withSpan('context compaction background summary', { attributes: { sessionId: session.id } }, async span => {
          const pressure = await this.pressure(agent, options.signal)
          if (pressure === null) return
          const { spec, measurement } = pressure
          const due =
            measurement.totalTokens >= Math.floor(spec.thresholdTokens * options.background.startRatio) && measurement.totalTokens < spec.thresholdTokens
          span.setAttribute('due', due)
          if (!due || session.surface.replaceGeneration !== generation) return
          const range = selectCompactableRange({ session, nodes: measurement.nodes, retainTokens: spec.retainTokens })
          const input = range === null ? null : summarizationInputFor(session, range)
          if (range === null || input === null) return
          span.setAttribute('messages', input.messages.length)
          const result = this.freshSummary(input, agent, options.signal).catch((error: unknown) => {
            if (!options.signal.aborted)
              this.ctx.logger.warn(`background compaction summary failed: ${errorText(error)}; the automatic compaction will summarize as usual`)
            return null
          })
          this.prepared.set(session, { generation, range, input, result })
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`background compaction summary skipped: ${errorText(error)}`)
      } finally {
        this.preparing.delete(session)
      }
    }

    /**
     * Commit the prepared summary over its own span when that span is still exactly what it summarized: same surface
     * generation, same replayed messages and tools. Anything else means the conversation moved past it, so it is
     * dropped and the caller compacts as usual. Newer messages stay verbatim in the retained tail.
     */
    private async applyPrepared(agent: Agent, signal: AbortSignal): Promise<CompactionResult | null> {
      const session = agent.session
      const prepared = this.prepared.get(session)
      if (prepared === undefined) return null
      const current = prepared.generation === session.surface.replaceGeneration ? summarizationInputFor(session, prepared.range) : null
      if (current === null || !isDeepStrictEqual(current, prepared.input) || (await prepared.result) === null) {
        this.prepared.delete(session)
        return null
      }
      try {
        return await this.compactRegion(prepared.range.start, prepared.range.end, agent, signal)
      } catch (error: unknown) {
        this.prepared.delete(session)
        if (signal.aborted) throw error
        this.ctx.logger.warn(`prepared compaction summary not applied: ${errorText(error)}; compacting as usual`)
        return null
      }
    }

    /**
     * The stock pressure loop for a route whose headroom buffer leaves no room: the stock engine refuses such a route
     * outright, so it never compacts proactively. Tool-result pruning is the stock path's and is skipped here.
     */
    private async compactWithoutHeadroom(agent: Agent, spec: CompactionSpec, signal: AbortSignal): Promise<CompactionResult | null> {
      const route = routeOf(agent.session)
      const retries = route === undefined ? this.config.compactionRetries : policyFor(this.config, route).compactionRetries
      let result: CompactionResult | null = null
      let measurement = this.ctx.tokenMeter.measure(agent.session)
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const range = selectCompactableRange({ session: agent.session, nodes: measurement.nodes, retainTokens: spec.retainTokens })
        if (range === null) return result
        result = await this.compactRegion(range.start, range.end, agent, signal)
        measurement = this.ctx.tokenMeter.measure(agent.session)
        if (measurement.totalTokens < spec.thresholdTokens) return result
      }
      throw new Error(
        `compaction still above threshold after ${String(retries + 1)} compaction attempts (${String(measurement.totalTokens)} estimated tokens >= threshold ${String(spec.thresholdTokens)})`,
      )
    }
  }
