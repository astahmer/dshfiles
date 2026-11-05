/** Pure copy for the failure card: what failed, how many retries ran, and the text its actions put in the composer. */

import { Wire } from './wire.js'

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

/** The fields of a native `turn-error` node the card reads; each stays unparsed until read. */
interface TurnErrorData {
  readonly message?: unknown
  readonly code?: unknown
}

/** The fields of a native `model-retry` node's current attempt the card reads. */
interface RetryAttemptData {
  readonly failure?: unknown
  readonly retryState?: unknown
  readonly retry?: unknown
  readonly mode?: unknown
  readonly maxRetries?: unknown
  readonly provider?: unknown
}

/** The provider failure a retry attempt carries. */
interface ProviderFailureData {
  readonly message?: unknown
  readonly reason?: unknown
  readonly code?: unknown
  readonly kind?: unknown
}

const parseTurnError = (data: unknown): FailureFacts => {
  const fields: TurnErrorData = Wire.isObject(data) ? data : {}
  return {
    kind: 'turn-error',
    message: Wire.readText(fields.message) ?? '',
    code: Wire.readText(fields.code),
    retry: undefined,
    maxRetries: undefined,
    retryState: undefined,
    provider: undefined,
  }
}

const parseModelRetry = (data: unknown): FailureFacts => {
  const current: RetryAttemptData = Wire.isObject(data) && 'current' in data && Wire.isObject(data.current) ? data.current : {}
  const failure: ProviderFailureData = Wire.isObject(current.failure) ? current.failure : {}
  const state = Wire.readText(current.retryState)
  return {
    kind: 'model-retry',
    message: Wire.readText(failure.message) ?? Wire.readText(failure.reason) ?? '',
    code: Wire.readText(failure.code) ?? Wire.readText(failure.kind),
    retry: Wire.readNumber(current.retry),
    maxRetries: current.mode === 'normal' ? Wire.readNumber(current.maxRetries) : undefined,
    retryState: state === 'scheduled' || state === 'started' || state === 'cancelled' ? state : undefined,
    provider: Wire.readText(current.provider),
  }
}

/** Codes the Host uses for a turn the user or DSH stopped, which need no fixing. */
const STOPPED_CODES: ReadonlySet<string> = new Set(['INTERRUPTED', 'ACCOUNT_SIGNED_OUT'])

export const Failure = {
  /** Read a native `turn-error` node's data. */
  fromTurnError: parseTurnError,

  /** Read a native `model-retry` node's data: its current attempt carries the provider failure. */
  fromModelRetry: parseModelRetry,

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
