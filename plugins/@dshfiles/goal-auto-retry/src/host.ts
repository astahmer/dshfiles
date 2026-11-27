import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import z from '@deepseek-ai/schemastery'
import { Api, HostContext } from '@dshfiles/dshx/effect'
import { Duration, Effect, Fiber } from 'effect'
import { defineHost } from '@dshfiles/dshx/host'
import { goalAutoRetryApi, type ArmingView, type PendingRetryView, type RetryFailureView, type RetryStatusView } from './api.js'
import {
  describeWait,
  planRetry,
  ProviderTiming,
  RetryPolicy,
  type FailureFacts as FailureFactsInput,
  type PendingRetry,
  type RetryFailure,
  type RetryStatus,
} from './policy.js'

export interface Config {
  readonly marginMinutes: number
  readonly baseBackoffMinutes: number
  readonly maxBackoffMinutes: number
  readonly maxAttempts: number
}

export const Config: z<Config> = z.object({
  marginMinutes: z
    .number()
    .min(0)
    .max(60)
    .default(3)
    .description('Extra wait after the reset the provider announced, so the retry does not land on the boundary.'),
  baseBackoffMinutes: z
    .number()
    .min(1)
    .max(120)
    .default(5)
    .description('First wait when the provider refused without saying when the limit lifts; each further attempt doubles it.'),
  maxBackoffMinutes: z.number().min(1).max(360).default(60).description('Ceiling for the doubling wait.'),
  maxAttempts: z.number().min(1).max(50).default(12).description('Give up after this many refused attempts on one goal, then leave it paused for a human.'),
})

/** A compare-and-set reference to one exact goal revision. */
export type GoalRef = { readonly id: GoalView['id']; readonly revision: number }

interface GoalsService {
  get(agent: Agent): GoalView | undefined
  resume(agent: Agent, ref: GoalRef): GoalView
}

interface AgentsService {
  get(sessionId: SessionId): Agent | undefined
}

interface SubagentsService {
  ownerOf(sessionId: SessionId): object | undefined
}

interface Logger {
  info(message: string, ...values: readonly unknown[]): void
  warn(message: string, ...values: readonly unknown[]): void
}

/**
 * The Cordis context, as this Host half uses it: named service reads that may be
 * absent, plus the logger. Every read is narrowed by its own owner below, so the
 * manager never touches an untyped service.
 */
export interface HostServices {
  get(name: 'goals'): GoalsService | undefined
  get(name: 'agents'): AgentsService | undefined
  get(name: 'subagents'): object | undefined
  get(name: string): object | undefined
  logger: Logger
}

/** The facts one refusal carries, as the retry reads them. */
export interface Refusal {
  readonly code: string
  readonly message: string
  /** Absolute epoch milliseconds the provider said the limit lifts, when it did. */
  readonly resetAtMs?: number
}

/** A goal round that was running when its turn failed. */
export interface FailedGoalRound {
  readonly goalId: string
  readonly round: number
}

/** An `LlmError`'s serializable facts, which the adapter fills and the Host carries beside the live error. */
interface FailureFacts {
  readonly code: string
  readonly message: string
  readonly providerRetryAfterMs?: number
}

/** `LlmError.failure` carries `providerRetryAfterMs` only when the provider sent a Retry-After, so it is optional here. */
const isFailureFacts = (value: unknown): value is FailureFacts => {
  if (typeof value !== 'object' || value === null || !('code' in value) || !('message' in value)) return false
  if (typeof value.code !== 'string' || typeof value.message !== 'string') return false
  return !('providerRetryAfterMs' in value) || value.providerRetryAfterMs === undefined || typeof value.providerRetryAfterMs === 'number'
}

const isSubagentsService = (value: unknown): value is SubagentsService => typeof value === 'object' && value !== null && 'ownerOf' in value

/** The reading of DSH's own values that the retry needs, kept out of the manager's bookkeeping. */
export class RetryInputs {
  /**
   * The failure a turn ended with, read from the agent's live error.
   *
   * DSH surfaces an `LlmError` here whose `failure` snapshot carries the stable
   * code; only the live error can also carry the provider's parsed `Retry-After`.
   */
  static failure(thrown: Error | undefined): Refusal | undefined {
    if (thrown === undefined) return undefined
    const carried = 'failure' in thrown ? thrown.failure : undefined
    const facts = isFailureFacts(carried) ? carried : isFailureFacts(thrown) ? thrown : undefined
    if (facts === undefined) return undefined
    const message = facts.message.length > 0 ? facts.message : thrown.message
    return typeof facts.providerRetryAfterMs === 'number' && facts.providerRetryAfterMs > 0
      ? { code: facts.code, message, resetAtMs: Date.now() + facts.providerRetryAfterMs }
      : { code: facts.code, message }
  }

  /** A subagent's thread is its parent's concern; the chip never offers to resume it. */
  static isSubagent(ctx: CordisContext, agent: Agent): boolean {
    if ('parent' in agent || 'parentSessionId' in agent) return true
    const subagents = ctx.get('subagents')
    if (!isSubagentsService(subagents)) return false
    return subagents.ownerOf(agent.id) !== undefined
  }

  /**
   * The goal round that failed: a human turn that failed spends no goal budget,
   * so only a turn whose opening prompt was a goal round is retried.
   */
  static failedGoalRound(agent: Agent): FailedGoalRound | undefined {
    const events = agent.session.snapshotEvents()
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event === undefined) continue
      if (event.type === 'turn/start') return undefined
      if (event.type !== 'user/message') continue
      const source = event.data.source
      if (source?.kind === 'goal' && source.round > 0) return { goalId: source.goalId, round: source.round }
    }
    return undefined
  }
}

/** The payload the chip reads: the manager's state plus that thread's own arming. */
export const statusView = (status: RetryStatus, arming: ArmingView): RetryStatusView => {
  switch (status.kind) {
    case 'idle':
      return { kind: 'idle', arming }
    case 'scheduled':
      return { kind: 'scheduled', retry: pendingView(status.retry), arming }
    case 'failed':
      return { kind: 'failed', retry: pendingView(status.retry), reason: status.reason, arming }
  }
}

const failureView = (failure: RetryFailure): RetryFailureView => {
  const view: RetryFailureView = { code: failure.code, message: failure.message }
  if (failure.resetAt !== undefined) return { ...view, resetAt: failure.resetAt }
  return view
}

const pendingView = (retry: PendingRetry): PendingRetryView => ({
  sessionId: retry.sessionId,
  goalId: retry.goalId,
  revision: retry.revision,
  attempt: retry.attempt,
  at: retry.at,
  delayMs: retry.delayMs,
  source: retry.source,
  failure: failureView(retry.failure),
})

/**
 * Owns every pending automatic goal retry.
 *
 * One timer per Session, replaced when a new refusal arrives. The timer runs on
 * the Host, not in a browser tab: closing the tab must not cancel the resume.
 *
 * Refusals are counted per goal across the resumes this manager fires, because a
 * fired resume is not a success: the round it starts can be refused again. The
 * count starts over when the goal changes, when it ran more than the one round a
 * resume starts, or when a human resumes it.
 */
export class GoalAutoRetry {
  readonly pending = new Map<string, PendingRetry>()
  readonly failed = new Map<string, { readonly retry: PendingRetry; readonly reason: string }>()
  private readonly armings = new Map<string, { readonly enabled: boolean; readonly delayMinutes: number }>()
  private readonly timers = new Map<string, Fiber.Fiber<void>>()
  private readonly attempts = new Map<string, { readonly goalId: string; readonly roundsStarted: number; readonly retry: PendingRetry }>()
  private readonly resuming = new Set<string>()

  constructor(
    private readonly ctx: HostServices,
    private readonly config: () => Config,
    private readonly publish: (sessionId: string) => void,
  ) {}

  private get goals(): GoalsService | undefined {
    return this.ctx.get('goals')
  }

  agentOf(sessionId: string): Agent | undefined {
    // SAFETY: the API handler passes the Session id string the browser sent, which is the same brand at runtime.
    return this.ctx.get('agents')?.get(sessionId as SessionId)
  }

  armingOf(sessionId: string): { readonly enabled: boolean; readonly delayMinutes: number } {
    return this.armings.get(sessionId) ?? { enabled: false, delayMinutes: 0 }
  }

  setArming(sessionId: string, arming: { readonly enabled: boolean; readonly delayMinutes: number }): void {
    this.armings.set(sessionId, arming)
    this.publish(sessionId)
  }

  status(sessionId: string): RetryStatus {
    const failed = this.failed.get(sessionId)
    if (failed !== undefined) return { kind: 'failed', retry: failed.retry, reason: failed.reason }
    const retry = this.pending.get(sessionId)
    return retry === undefined ? { kind: 'idle' } : { kind: 'scheduled', retry }
  }

  /** Arm a wait for a refusal. Returns whether a retry was scheduled. */
  schedule(input: { readonly agent: Agent; readonly failure: RetryFailure; readonly overrideDelayMs?: number | undefined }): boolean {
    const config = this.config()
    const sessionId = String(input.agent.id)
    const goal = this.goals?.get(input.agent)
    if (goal === undefined) return false
    const previous = this.attempts.get(sessionId)
    const consecutive = previous !== undefined && previous.goalId === goal.id && goal.roundsStarted - previous.roundsStarted <= 1
    const attempt = consecutive ? previous.retry.attempt + 1 : 1
    if (attempt > config.maxAttempts) {
      this.giveUp(sessionId, `gave up after ${String(config.maxAttempts)} refused attempts`)
      return false
    }
    const configuredDelay = this.armingOf(sessionId).delayMinutes
    const stated = input.failure.resetAt
    const facts: FailureFactsInput = { code: input.failure.code, message: input.failure.message }
    const plan = planRetry({
      failure: stated === undefined ? facts : { ...facts, resetAtMs: stated },
      now: Date.now(),
      overrideDelayMs: input.overrideDelayMs ?? (configuredDelay > 0 ? configuredDelay * 60_000 : undefined),
      attempt,
      marginMs: config.marginMinutes * 60_000,
      minimumDelayMs: 60_000,
      baseDelayMs: config.baseBackoffMinutes * 60_000,
      maxBackoffMs: config.maxBackoffMinutes * 60_000,
    })
    this.failed.delete(sessionId)
    const retry: PendingRetry = {
      sessionId,
      goalId: goal.id,
      revision: goal.revision,
      attempt,
      at: plan.at,
      delayMs: plan.delayMs,
      source: plan.source,
      failure: input.failure,
    }
    this.attempts.set(sessionId, { goalId: goal.id, roundsStarted: goal.roundsStarted, retry })
    this.arm(retry)
    this.ctx.logger.info('goal-auto-retry: goal "%s" of thread "%s" retries in %s (%s)', goal.id, sessionId, describeWait(plan.delayMs), plan.source)
    return true
  }

  /** Arm by hand, for a thread whose last refusal this Host no longer holds. */
  scheduleManual(agent: Agent, delayMinutes: number | undefined): boolean {
    const known = this.pending.get(String(agent.id))
    const failure: RetryFailure = known?.failure ?? { code: 'RATE_LIMIT', message: 'retry requested from the composer' }
    if (delayMinutes === undefined) return this.schedule({ agent, failure })
    return this.schedule({ agent, failure, overrideDelayMs: delayMinutes * 60_000 })
  }

  cancel(sessionId: string): void {
    this.clearTimer(sessionId)
    this.attempts.delete(sessionId)
    const hadPending = this.pending.delete(sessionId)
    const hadFailed = this.failed.delete(sessionId)
    if (hadPending || hadFailed) this.publish(sessionId)
  }

  /**
   * A human resumed by hand: the pending resume is spent, so drop it without
   * touching the goal, and count refusals from zero again. DSH reports this
   * manager's own resume through the same event, which is not a human one.
   */
  noteManualResume(agent: Agent): void {
    const sessionId = String(agent.id)
    if (this.resuming.has(sessionId)) return
    this.attempts.delete(sessionId)
    if (!this.pending.has(sessionId)) return
    this.clearTimer(sessionId)
    this.pending.delete(sessionId)
    this.failed.delete(sessionId)
    this.publish(sessionId)
  }

  /** Resume exactly the goal this timer was armed for. Exposed for the tests' clock. */
  fire(sessionId: string, now: number = Date.now()): void {
    const retry = this.pending.get(sessionId)
    if (retry === undefined) return
    if (now < retry.at) {
      this.arm(retry)
      return
    }
    const agent = this.agentOf(sessionId)
    if (agent === undefined) {
      this.fail(sessionId, 'this thread is no longer open on this Host')
      return
    }
    const goals = this.goals
    const goal = goals?.get(agent)
    if (goals === undefined || goal === undefined || goal.id !== retry.goalId) {
      this.fail(sessionId, 'the goal was cleared or replaced')
      return
    }
    if (goal.phase === 'complete') {
      this.pending.delete(sessionId)
      this.publish(sessionId)
      return
    }
    if (goal.roundsStarted >= goal.maxGoalRounds) {
      this.fail(sessionId, `the goal used its ${String(goal.maxGoalRounds)} rounds`)
      return
    }
    this.resuming.add(sessionId)
    try {
      goals.resume(agent, { id: goal.id, revision: goal.revision })
    } catch (error) {
      this.fail(sessionId, error instanceof Error ? error.message : String(error))
      return
    } finally {
      this.resuming.delete(sessionId)
    }
    this.pending.delete(sessionId)
    this.publish(sessionId)
  }

  dispose(): void {
    for (const sessionId of [...this.timers.keys()]) this.clearTimer(sessionId)
    this.pending.clear()
    this.failed.clear()
    this.armings.clear()
    this.attempts.clear()
  }

  private arm(retry: PendingRetry): void {
    this.clearTimer(retry.sessionId)
    this.pending.set(retry.sessionId, retry)
    const delay = Math.min(Math.max(1, retry.at - Date.now()), 2 ** 31 - 1)
    const timer = Effect.runFork(
      Effect.sleep(Duration.millis(delay)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            this.timers.delete(retry.sessionId)
            this.fire(retry.sessionId)
          }),
        ),
      ),
    )
    this.timers.set(retry.sessionId, timer)
    this.publish(retry.sessionId)
  }

  private fail(sessionId: string, reason: string): void {
    const retry = this.pending.get(sessionId) ?? this.attempts.get(sessionId)?.retry
    if (retry === undefined) return
    this.pending.delete(sessionId)
    this.clearTimer(sessionId)
    this.failed.set(sessionId, { retry, reason })
    this.ctx.logger.warn('goal-auto-retry: goal "%s" of thread "%s" stays paused: %s', retry.goalId, sessionId, reason)
    this.publish(sessionId)
  }

  private giveUp(sessionId: string, reason: string): void {
    this.clearTimer(sessionId)
    this.fail(sessionId, reason)
  }

  private clearTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId)
    if (timer === undefined) return
    this.timers.delete(sessionId)
    Effect.runFork(Fiber.interrupt(timer))
  }
}

/**
 * The live manager of one plugin instance, reachable from that instance's API
 * handlers. Replaced on reload, so a stale handler cannot resume a dead timer.
 */
class LiveManagers {
  private static readonly byContext = new WeakMap<CordisContext, GoalAutoRetry>()

  static set(ctx: CordisContext, manager: GoalAutoRetry): void {
    LiveManagers.byContext.set(ctx, manager)
  }

  static release(ctx: CordisContext): void {
    LiveManagers.byContext.delete(ctx)
  }

  static of(ctx: CordisContext): GoalAutoRetry | undefined {
    return LiveManagers.byContext.get(ctx)
  }
}

const localIdle: RetryStatusView = { kind: 'idle', arming: { enabled: false, delayMinutes: 0 } }

export default defineHost({
  name: '@dshfiles/goal-auto-retry',
  Config,
  inject: ['agents', 'goals', 'sessions'],
  setup: (ctx, config) => {
    // SAFETY: every service this plugin reads is injected above, and the native Context exposes them by name.
    const host = ctx as unknown as HostServices
    // SAFETY: defineHost decodes the row config through Config above, so the value has exactly its shape.
    const settings = config as Config
    const manager = new GoalAutoRetry(
      host,
      () => settings,
      sessionId => {
        Effect.runFork(
          Api.publish({ contract: goalAutoRetryApi, event: 'changed', payload: { sessionId } }).pipe(
            Effect.ignore,
            Effect.provide(HostContext.layer({ ctx: ctx as never, packageId: '@dshfiles/goal-auto-retry' })),
          ),
        )
      },
    )
    LiveManagers.set(ctx, manager)
    ctx.effect(
      () => () => {
        LiveManagers.release(ctx)
        manager.dispose()
      },
      'goal-auto-retry: timers',
    )
    ctx.effect(
      () =>
        ctx.on('agent/error', ({ agent, error }) => {
          if (!manager.armingOf(String(agent.id)).enabled) return
          if (RetryInputs.isSubagent(ctx, agent)) return
          if (RetryInputs.failedGoalRound(agent) === undefined) return
          if (ctx.goals.get(agent) === undefined) return
          const refusal = error instanceof Error ? RetryInputs.failure(error) : undefined
          if (refusal === undefined || !RetryPolicy.isRetryableFailure(refusal)) return
          const resetAt = ProviderTiming.resetAt(refusal, Date.now())
          const retryFailure: RetryFailure = { code: refusal.code, message: refusal.message }
          manager.schedule({ agent, failure: resetAt === undefined ? retryFailure : { ...retryFailure, resetAt } })
        }),
      'goal-auto-retry: refusals',
    )
    ctx.effect(
      () =>
        ctx.on('goal/changed', ({ agent, change }) => {
          if (change.operation === 'resume') manager.noteManualResume(agent)
        }),
      'goal-auto-retry: manual resumes',
    )
  },
  apis: [
    goalAutoRetryApi.host({
      status: ({ ctx, input }) => {
        const manager = LiveManagers.of(ctx)
        return manager === undefined ? localIdle : statusView(manager.status(input.sessionId), manager.armingOf(input.sessionId))
      },
      arm: ({ ctx, input }) => {
        const manager = LiveManagers.of(ctx)
        if (manager === undefined) return localIdle
        manager.setArming(input.sessionId, { enabled: input.enabled, delayMinutes: input.delayMinutes })
        return statusView(manager.status(input.sessionId), manager.armingOf(input.sessionId))
      },
      schedule: ({ ctx, input }) => {
        const manager = LiveManagers.of(ctx)
        if (manager === undefined) throw new Error('Automatic goal retry is not loaded on this Host.')
        const agent = manager.agentOf(input.sessionId)
        if (agent === undefined) throw new Error('This thread is not open on this Host.')
        if (!manager.scheduleManual(agent, input.delayMinutes)) throw new Error('There is no goal to resume in this thread, or its retry budget is spent.')
        return statusView(manager.status(input.sessionId), manager.armingOf(input.sessionId))
      },
      cancel: ({ ctx, input }) => {
        const manager = LiveManagers.of(ctx)
        if (manager === undefined) return localIdle
        manager.cancel(input.sessionId)
        return statusView(manager.status(input.sessionId), manager.armingOf(input.sessionId))
      },
    }),
  ],
})
