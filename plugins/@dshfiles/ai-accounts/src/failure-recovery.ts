import { isContextWindowExceededError, isQuotaExceededError, type LlmFailure, type Message } from '@deepseek-ai/dsh-llm'
import type { AccountPool } from './account-pool.js'
import { decideRecovery, NO_PROGRESS, type FailureKind, type RecoveryPolicy, type RecoveryProgress, type RecoveryStep } from './failure-policy.js'

const EXHAUSTED_CODES: ReadonlySet<string> = new Set([
  'QUOTA',
  'ACCOUNT_QUOTA',
  'QUOTA_EXCEEDED',
  'ACCOUNT_QUOTA_EXCEEDED',
  'INSUFFICIENT_QUOTA',
  'USAGE_LIMIT_REACHED',
])
const RATE_LIMIT_CODES: ReadonlySet<string> = new Set(['RATE_LIMIT', 'RATE_LIMIT_EXCEEDED'])
const AUTH_CODES: ReadonlySet<string> = new Set(['AUTH', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'ACCOUNT_SIGNED_OUT', 'ACCOUNT_SIGN_IN_REQUIRED'])
const TRANSPORT_CODES: ReadonlySet<string> = new Set(['TRANSPORT', 'TIMEOUT', 'OVERLOADED', 'LLM_STREAM_IDLE_TIMEOUT'])
const OPENAI_RETRY_HINT = /An error occurred while processing your request\.\s+You can retry your request\b/i
const OVERSIZED_TEXT = /\b(?:request|payload|body)(?: entity)? (?:is )?too large\b/i
/**
 * Spent-plan wording that carries no `usage limit exceeded` phrase to match, e.g.
 * ChatGPT's "You have hit your ChatGPT usage limit (plus plan). Try again in ~151 min."
 * or Claude's "You've hit your limit · resets 3:00 PM". `isQuotaExceededError` needs the
 * limit word followed by exceeded/exhausted/reached, so this lands as `PI_AI_ERROR` and
 * a retry only spends another attempt on a plan that is already spent.
 */
const SPENT_PLAN_HINT = /\byou(?:'ve| have)\s+(?:hit|reached)\s+(?:your|the)\s+(?:(?:\w+\s+){0,2}(?:usage|weekly|daily|plan|message)\s+)?limits?\b/i

/** `undefined` for failures this plugin leaves alone (image offload, empty responses, cancellations…). */
export const classifyFailure = (failure: Pick<LlmFailure, 'code' | 'message' | 'status'>): FailureKind | undefined => {
  if (
    failure.code === 'CONTEXT_WINDOW_EXCEEDED' ||
    failure.status === 413 ||
    OVERSIZED_TEXT.test(failure.message) ||
    isContextWindowExceededError(failure.message)
  ) {
    return 'oversized'
  }
  if (EXHAUSTED_CODES.has(failure.code) || isQuotaExceededError(`${failure.code} ${failure.message}`) || SPENT_PLAN_HINT.test(failure.message)) {
    return 'exhausted'
  }
  if (RATE_LIMIT_CODES.has(failure.code) || failure.status === 429) return 'rateLimit'
  if (AUTH_CODES.has(failure.code) || failure.status === 401 || failure.status === 403) return 'auth'
  if (
    TRANSPORT_CODES.has(failure.code) ||
    (failure.status !== undefined && failure.status >= 500) ||
    (failure.code === 'PI_AI_ERROR' && OPENAI_RETRY_HINT.test(failure.message))
  ) {
    return 'transport'
  }
  return undefined
}

export type RecoveryAction =
  | { readonly kind: 'pass' }
  | {
      readonly kind: 'retry'
      readonly step: Exclude<RecoveryStep, { kind: 'give-up' }>
      readonly failureKind: FailureKind
      /** The account that failed (after any earlier fail-over), not the route the conversation chose. */
      readonly account: string
      readonly attempt: number
      readonly plannedAttempts: number
      readonly retryId: string
    }
  | { readonly kind: 'give-up'; readonly then: 'fail' | 'dsh'; readonly failureKind: FailureKind; readonly account: string }

/**
 * What to persist when a turn gives up: how it restarts, or `undefined` when
 * DSH itself still rescued the step. A give-up already means the ladder ran out
 * — fail-over is only skipped when no other account could take the request — so
 * a spent plan ends the turn whether or not fail-over is switched on.
 */
export const quotaRecoveryFor = (input: {
  readonly failureKind: FailureKind
  readonly rescued: boolean
  readonly autoRetryDefault: boolean
}): { readonly autoRetry: boolean } | undefined => {
  if (input.rescued) return undefined
  if (input.failureKind === 'rateLimit') return { autoRetry: true }
  if (input.failureKind === 'exhausted') return { autoRetry: input.autoRetryDefault }
  return undefined
}

/**
 * One DSH retry chain: a step's failure kind owns its own attempt sequence and
 * its own `retryId`. DSH validates a stored log chain by chain — keyed by turn,
 * step, provider and policy key — so sharing either across failure kinds makes
 * the whole log unreadable and fails every session-content search.
 */
interface ChainState {
  readonly retryId: string
  attempts: number
  progress: RecoveryProgress
}

interface StepState {
  readonly turn: number
  readonly step: number
  shrink: boolean
  readonly chains: Map<FailureKind, ChainState>
}

/**
 * Applies the policy against the live pool: which account actually served a
 * conversation, who is cooling, and where a fail-over goes. One state per
 * conversation, reset whenever a new step fails.
 */
export const createFailureRecovery = (deps: {
  readonly pool: Pick<AccountPool, 'isHealthy' | 'noteRateLimited' | 'bindRoute' | 'routeFor' | 'unbind'>
  readonly isAccountRoute: (provider: string) => boolean
  readonly readPolicy: () => RecoveryPolicy
  /** Ordered, compatible, visible accounts that could take over from `from` for `model`; health is checked here. */
  readonly failoverCandidates: (input: { readonly from: string; readonly model: string | undefined }) => readonly string[]
  readonly lunaReserve: { readonly available: (accountId: string) => boolean; readonly engage: (accountId: string) => void }
  readonly newRetryId: () => string
}) => {
  const steps = new Map<string, StepState>()

  const stateFor = (conversationKey: string, turn: number, step: number): StepState => {
    const existing = steps.get(conversationKey)
    if (existing !== undefined && existing.turn === turn && existing.step === step) return existing
    const fresh: StepState = { turn, step, shrink: false, chains: new Map() }
    steps.set(conversationKey, fresh)
    return fresh
  }

  const chainFor = (state: StepState, failureKind: FailureKind): ChainState => {
    const existing = state.chains.get(failureKind)
    if (existing !== undefined) return existing
    const chain: ChainState = { retryId: deps.newRetryId(), attempts: 0, progress: NO_PROGRESS }
    state.chains.set(failureKind, chain)
    return chain
  }

  return {
    routeFor: (conversationKey: string | undefined, provider: string, now = Date.now()): string => deps.pool.routeFor(conversationKey, provider, now),

    /** Whether this step's remaining attempts go out without re-sent images. */
    shrinkActive: (conversationKey: string, turn: number, step: number): boolean => {
      const state = steps.get(conversationKey)
      return state !== undefined && state.turn === turn && state.step === step && state.shrink
    },

    recover: (input: {
      readonly conversationKey: string
      readonly turn: number
      readonly step: number
      readonly provider: string
      readonly routedAccountId?: string
      readonly model: string | undefined
      readonly failure: LlmFailure
      /** Whether the request still re-sends an image the model has already answered. */
      readonly canShrink: boolean
      readonly now?: number
    }): RecoveryAction => {
      if (!deps.isAccountRoute(input.provider)) return { kind: 'pass' }
      const failureKind = classifyFailure(input.failure)
      if (failureKind === undefined) return { kind: 'pass' }
      const now = input.now ?? Date.now()
      const account = input.routedAccountId ?? deps.pool.routeFor(input.conversationKey, input.provider, now)
      const policy = deps.readPolicy()[failureKind]
      const state = stateFor(input.conversationKey, input.turn, input.step)
      const candidates = policy.failover
        ? deps.failoverCandidates({ from: account, model: input.model }).filter(id => id !== account && deps.pool.isHealthy(id, now))
        : []
      const chain = chainFor(state, failureKind)
      const decision = decideRecovery({
        policy,
        progress: chain.progress,
        retryAfterMs: input.failure.providerRetryAfterMs,
        lunaReserveAvailable: policy.lunaReserve && deps.lunaReserve.available(account),
        failoverTo: candidates[0],
        canShrink: input.canShrink,
      })
      chain.progress = decision.progress
      const step = decision.step

      if (step.kind === 'give-up') {
        if (failureKind === 'rateLimit' || failureKind === 'exhausted') deps.pool.noteRateLimited(account, input.failure.providerRetryAfterMs, now)
        return { kind: 'give-up', then: step.then, failureKind, account }
      }
      if (step.kind === 'luna-reserve') deps.lunaReserve.engage(account)
      if (step.kind === 'failover') {
        deps.pool.noteRateLimited(account, input.failure.providerRetryAfterMs, now)
        deps.pool.bindRoute(input.conversationKey, input.provider, step.to, account)
      }
      if (step.kind === 'shrink') state.shrink = true
      chain.attempts += 1
      const plannedAttempts =
        policy.retries + (policy.lunaReserve ? 1 : 0) + candidates.length * (policy.retries + 1) + (policy.waitSeconds > 0 ? 1 : 0) + (policy.shrink ? 1 : 0)
      return {
        kind: 'retry',
        step,
        failureKind,
        account,
        attempt: chain.attempts,
        plannedAttempts: Math.max(plannedAttempts, chain.attempts),
        retryId: chain.retryId,
      }
    },

    forget: (conversationKey: string): void => {
      steps.delete(conversationKey)
      deps.pool.unbind(conversationKey)
    },
  }
}

export type FailureRecovery = ReturnType<typeof createFailureRecovery>

/**
 * Offload every image sent before the latest assistant answer, so the request
 * carries a file placeholder (name and read-only path) instead of the bytes.
 * The newest input keeps its images; the session log is untouched. Returns the
 * same array when nothing was re-sent.
 */
export const offloadResentImages = (messages: readonly Message[]): readonly Message[] => {
  const lastAnswer = messages.findLastIndex(message => message.role === 'assistant')
  let changed = false
  const next = messages.map((message, index) => {
    if (index >= lastAnswer || !message.content.some(block => block.type === 'image' && block.offloaded !== true)) return message
    changed = true
    return {
      ...message,
      content: message.content.map(block => (block.type === 'image' && block.offloaded !== true ? { ...block, offloaded: true as const } : block)),
    }
  })
  return changed ? next : messages
}
