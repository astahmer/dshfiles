/**
 * When an idle thread is worth compacting before its prompt cache expires.
 *
 * A thread idle past its provider's cache lifetime re-sends its whole prompt uncached on the next message. One
 * compaction shortly before that costs less than the re-sent prompt when the thread resumes much later, and nothing
 * at all when it never resumes. The sweep therefore needs an exact answer to one question: is this thread large
 * enough, untouched for long enough, and not already compacted at this idle stretch?
 */

export interface IdleCompactionPolicy {
  readonly enabled: boolean
  /** Prompt tokens below which a thread is left alone: compacting a small thread costs more than the re-send. */
  readonly minTokens: number
  /** How long the provider keeps a prompt prefix cached, counted from the last request that used it. */
  readonly lifetimeMinutes: number
  /** How long before that lifetime ends to compact; the sweep also runs at this interval. */
  readonly leadMinutes: number
}

export const DEFAULT_IDLE_COMPACTION: IdleCompactionPolicy = {
  enabled: false,
  minTokens: 100_000,
  lifetimeMinutes: 5,
  leadMinutes: 1,
}

const MINUTE_MS = 60_000

export class IdleCompactionModel {
  /** The moment one idle stretch becomes due: the cache lifetime end minus the lead. */
  static readonly dueAt = (input: { readonly lastActivityAt: number; readonly policy: IdleCompactionPolicy }): number =>
    input.lastActivityAt + (input.policy.lifetimeMinutes - input.policy.leadMinutes) * MINUTE_MS

  /** The moment that idle stretch's cache is gone: a later compaction saves no re-send, so it must not run. */
  static readonly expiresAt = (input: { readonly lastActivityAt: number; readonly policy: IdleCompactionPolicy }): number =>
    input.lastActivityAt + input.policy.lifetimeMinutes * MINUTE_MS

  /**
   * Whether one thread should be compacted now. `attemptedAt` is the idle start of the last compaction this sweep
   * tried for the same idle stretch: an attempt is one billed request even when it fails, so a second pass must not
   * pay for the same stretch twice, and a new request arms a new stretch.
   */
  static readonly due = (input: {
    readonly now: number
    readonly lastActivityAt: number | null
    readonly attemptedAt: number | null
    readonly tokens: number | null
    readonly policy: IdleCompactionPolicy
  }): boolean => {
    if (!input.policy.enabled || input.policy.lifetimeMinutes <= input.policy.leadMinutes) return false
    if (input.lastActivityAt === null) return false
    if (input.tokens !== null && input.tokens < input.policy.minTokens) return false
    if (input.attemptedAt !== null && input.attemptedAt >= input.lastActivityAt) return false
    if (input.now >= IdleCompactionModel.expiresAt({ lastActivityAt: input.lastActivityAt, policy: input.policy })) return false
    return input.now >= IdleCompactionModel.dueAt({ lastActivityAt: input.lastActivityAt, policy: input.policy })
  }
}
