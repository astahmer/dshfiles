import { errorSentence } from '@dshfiles/plugin-ui/lib/error-copy'

/** The failure a native Host call returns: `{ ok: false, error: { code, message } }`. */
export interface RpcError {
  readonly code: string
  readonly message: string
}

/** The prefix the native client adds to a call it could not complete: `client api: session/prompt failed: `. */
const CLIENT_API_PREFIX = /^client api: \S+ failed: /u
const HTTP_STATUS = /\bHTTP (\d{3})\b/u
/** The code the native connection gives a call that never got a Host answer (a failed fetch, a refused socket). */
const TRANSPORT_CODE = 'gateway/internal'

/**
 * One sentence for a failed native Host call (DESIGN.md Error copy): the kit's `errorSentence`, fed the fields the
 * native error carries instead of its developer text. A transport failure is `transport` (DSH away), anything the
 * Host answered is `remote` (its own sentence when it reads as one).
 */
export const RpcFailure = {
  asError(error: RpcError): Error {
    const message = error.message.replace(CLIENT_API_PREFIX, '')
    const status = HTTP_STATUS.exec(message)?.[1]
    const failure = Object.assign(new Error(message), { code: error.code, kind: error.code === TRANSPORT_CODE ? 'transport' : 'remote' })
    if (status !== undefined) Object.assign(failure, { status: Number(status) })
    return failure
  },

  sentence(input: { readonly subject: string; readonly error: RpcError; readonly kept?: string }): string {
    const error = RpcFailure.asError(input.error)
    if (input.kept === undefined) return errorSentence({ subject: input.subject, error }).sentence
    return errorSentence({ subject: input.subject, error, kept: input.kept }).sentence
  },
}
