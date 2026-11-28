/**
 * One sentence for a failure (DESIGN.md Error copy, round four D7). Five classes, decided from the fields an error
 * carries (dshx's `ApiError` has `kind`, `status`, `endpoint` and `remoteCode`), never from an endpoint in its text:
 *
 * | kind          | when                                                         | sentence                                                                     |
 * | ------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
 * | `unreachable` | nothing answered: a failed fetch, a transport failure with no status, a 502/504 from the tunnel | Could not reach DSH.              |
 * | `request`     | DSH answered with a failure (5xx, 408, 429, a contract mismatch, a handler error worded for developers) | {subject} did not load (HTTP 500). Retry; if it repeats, check the DSH terminal. |
 * | `missing`     | the owning plugin's Host half is not loaded (404)           | {subject} is not available: its plugin did not start. Open Settings › Plugins. |
 * | `credential`  | no account or key can run the model                          | No AI account can run this model. Connect an account, then send again.       |
 * | `refused`     | a 4xx (other than 404, 408, 429) or a handler's own sentence | that sentence; Retry is secondary                                            |
 *
 * A sentence never holds an endpoint id, `client api:`, a route id, an environment variable, a file path or text
 * written for the model: the raw text, the code and the endpoint go to `detail`, which the UI puts under Details.
 */

export type ErrorKind = 'unreachable' | 'request' | 'missing' | 'credential' | 'refused'

/** Which button leads: `primary` when retrying can succeed, `secondary` when it rarely does, `none` when it cannot. */
export type ErrorRetry = 'primary' | 'secondary' | 'none'

export interface ErrorSentenceInput {
  /** What failed, as the page names it: "Inbox", "Account order". */
  readonly subject: string
  readonly error: unknown
  /** What the user still has, appended when DSH was away or failed: "Your message is kept; send it again once DSH is back." */
  readonly kept?: string
}

export interface ErrorCopy {
  readonly kind: ErrorKind
  readonly sentence: string
  /** The raw text, code, status and endpoint, one per line: for Details only. Empty when there is nothing more. */
  readonly detail: string
  readonly retry: ErrorRetry
}

/** The fields a failure may carry: dshx's `ApiError`, a fetch `TypeError`, a provider error with `code` and `status`. */
interface ErrorFacts {
  readonly message: string
  readonly status: number | undefined
  readonly code: string | undefined
  readonly kind: string | undefined
  readonly endpoint: string | undefined
}

type FactKey = 'status' | 'remoteCode' | 'code' | 'kind' | 'endpoint'

/** Any failure as an `Error`: a plain `{ code, message }` from an RPC result keeps its fields, a string becomes the message. */
const asError = (error: unknown): Error => {
  if (error instanceof Error) return error
  if (error instanceof Object) return Object.assign(new Error(), error)
  return new Error(error === undefined || error === null ? '' : String(error))
}

/** An own field of a failure as text. An object would print `[object Object]`, so only a primitive counts. */
const textOf = (error: Error, key: FactKey): string | undefined => {
  const value = Object.getOwnPropertyDescriptor(error, key)?.value
  return value instanceof Object || value === undefined || value === null || value === '' ? undefined : String(value)
}

const factsOf = (error: unknown): ErrorFacts => {
  const failure = asError(error)
  const status = Number(textOf(failure, 'status'))
  return {
    message: String(failure.message),
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
    code: textOf(failure, 'remoteCode') ?? textOf(failure, 'code'),
    kind: textOf(failure, 'kind'),
    endpoint: textOf(failure, 'endpoint'),
  }
}

/** What browsers say when a fetch never got an answer: Chrome, Safari, Firefox. */
const NETWORK_FAILURE = /^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?|network ?error)$/iu
/** The provider or the core runtime saying there is no key to use. */
const NO_CREDENTIAL = /\bno api key\b|\bmissing (?:an? )?(?:api )?(?:key|credential)s?\b|\bapi key (?:is )?(?:missing|not (?:set|configured))\b/iu
/** Status codes a tunnel or proxy answers for a DSH it cannot reach. */
const GATEWAY_DOWN = new Set([502, 504])

/** Text that would print something the user cannot act on (see the module comment). */
const DEVELOPER_TEXT = [
  /\/api\//u,
  /\bdshx-/u,
  /client api:/iu,
  /transport failure/iu,
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/u,
  /(?:^|[\s(])(?:~|\.{1,2})?\/[\w.-]+\/[\w./-]*/u,
  /\b[A-Z]:\\/u,
  /\b(?:E[A-Z]{3,}|ERR_[A-Z_]+)\b/u,
  /\((?:[a-z]+[-_/])+[a-z0-9]+\)$/u,
]

const presentable = (text: string): boolean => text.length > 0 && text.length <= 240 && !DEVELOPER_TEXT.some(pattern => pattern.test(text))

const asSentence = (text: string): string => {
  const trimmed = text.trim()
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?…]$/u.test(capitalised) ? capitalised : `${capitalised}.`
}

const withKept = (sentence: string, kept: string | undefined): string => (kept === undefined || kept === '' ? sentence : `${sentence} ${kept}`)

const detailOf = ({ message, status, code, endpoint }: ErrorFacts): string => {
  const lines = [message]
  if (code !== undefined) lines.push(`Code: ${code}`)
  if (status !== undefined && !message.includes(String(status))) lines.push(`HTTP status: ${status}`)
  if (endpoint !== undefined && !message.includes(endpoint)) lines.push(`Endpoint: ${endpoint}`)
  return lines.filter(line => line !== '').join('\n')
}

const classify = ({ message, status, code, kind }: ErrorFacts): ErrorKind => {
  if (code === 'MISSING_CREDENTIAL' || NO_CREDENTIAL.test(message)) return 'credential'
  if (code === 'owner-missing' || status === 404) return 'missing'
  if (status !== undefined && GATEWAY_DOWN.has(status)) return 'unreachable'
  if (NETWORK_FAILURE.test(message.trim())) return 'unreachable'
  if (kind === 'unavailable' || (kind === 'transport' && status === undefined)) return 'unreachable'
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return presentable(message) ? 'refused' : 'request'
  if (kind === 'remote' && presentable(message)) return 'refused'
  return 'request'
}

/** The sentence, Details text and Retry weight for a failure of `subject`. */
export const errorSentence = (input: ErrorSentenceInput): ErrorCopy => {
  const facts = factsOf(input.error)
  const { message, status } = facts
  const kind = classify(facts)
  const detail = detailOf(facts)
  switch (kind) {
    case 'unreachable':
      return { kind, sentence: withKept('Could not reach DSH.', input.kept), detail, retry: 'primary' }
    case 'missing':
      return { kind, sentence: `${input.subject} is not available: its plugin did not start. Open Settings › Plugins.`, detail, retry: 'none' }
    case 'credential':
      return { kind, sentence: 'No AI account can run this model. Connect an account, then send again.', detail, retry: 'none' }
    case 'refused':
      return { kind, sentence: asSentence(message), detail, retry: 'secondary' }
    case 'request': {
      const http = status === undefined ? '' : ` (HTTP ${status})`
      return { kind, sentence: withKept(`${input.subject} did not load${http}. Retry; if it repeats, check the DSH terminal.`, input.kept), detail, retry: 'primary' }
    }
  }
}
