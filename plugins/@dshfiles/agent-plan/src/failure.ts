/** Pure copy for the failure card: what failed, how many retries ran, and the text its actions put in the composer. */

export interface FailureFacts {
  /** `turn-error` for a turn that ended in an error, `model-retry` for a request the Host is retrying. */
  readonly kind: 'turn-error' | 'model-retry'
  readonly message: string
  readonly code: string | undefined
  /** Retry attempt number for a model-retry node. */
  readonly retry: number | undefined
  /** Maximum retries, absent when the policy retries forever. */
  readonly maxRetries: number | undefined
  readonly retryState: 'scheduled' | 'started' | 'cancelled' | undefined
  readonly provider: string | undefined
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const field = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined)

/** Codes the Host uses for a turn the user or DSH stopped, which need no fixing. */
const STOPPED_CODES: ReadonlySet<string> = new Set(['INTERRUPTED', 'ACCOUNT_SIGNED_OUT'])

export const Failure = {
  /** Read a native `turn-error` node's data. */
  fromTurnError(data: unknown): FailureFacts {
    return {
      kind: 'turn-error',
      message: text(field(data, 'message')) ?? '',
      code: text(field(data, 'code')),
      retry: undefined,
      maxRetries: undefined,
      retryState: undefined,
      provider: undefined,
    }
  },

  /** Read a native `model-retry` node's data: its current attempt carries the provider failure. */
  fromModelRetry(data: unknown): FailureFacts {
    const current = field(data, 'current')
    const failure = field(current, 'failure')
    const state = text(field(current, 'retryState'))
    return {
      kind: 'model-retry',
      message: text(field(failure, 'message')) ?? text(field(failure, 'reason')) ?? '',
      code: text(field(failure, 'code')) ?? text(field(failure, 'kind')),
      retry: count(field(current, 'retry')),
      maxRetries: field(current, 'mode') === 'normal' ? count(field(current, 'maxRetries')) : undefined,
      retryState: state === 'scheduled' || state === 'started' || state === 'cancelled' ? state : undefined,
      provider: text(field(current, 'provider')),
    }
  },

  /** Whether the card offers actions: a stopped turn and a retry still in flight need none. */
  actionable(facts: FailureFacts): boolean {
    if (facts.kind === 'turn-error') return facts.code === undefined || !STOPPED_CODES.has(facts.code)
    return facts.retryState === 'cancelled'
  },

  /** "Retry 2 of 5", "Retry 3", or undefined for a turn error. */
  retryLabel(facts: FailureFacts): string | undefined {
    if (facts.retry === undefined) return undefined
    return facts.maxRetries === undefined ? `Retry ${facts.retry}` : `Retry ${facts.retry} of ${facts.maxRetries}`
  },

  /** What "Retry" puts in the composer: the user still sends it. */
  retryPrompt(): string {
    return 'Retry the last step that failed and continue the task.'
  },

  /** What "Ask to fix" puts in the composer, quoting the failure. */
  fixPrompt(facts: FailureFacts): string {
    const what = [facts.code, facts.message].filter(part => part !== undefined && part !== '').join(': ')
    return `The last turn failed${what === '' ? '' : ` with "${what}"`}. Find the cause, fix it, and then continue the task.`
  },
}
