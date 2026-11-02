import { Effect, Option, Schema } from 'effect'
import { jsonValueSchema, nativeRpcResultSchema, type NativeRpcRequest, type NativeRpcResult } from './api.js'
import type { Gateway } from './connectors/gateway.js'
import { failureCodeOf, type TaggedFailure } from './errors.js'

const decodeArgs = Schema.decodeUnknownEffect(Schema.Record(Schema.String, jsonValueSchema))
const decodeResult = Schema.decodeUnknownOption(nativeRpcResultSchema)

const unknownOutcome: NativeRpcResult = {
  ok: false,
  code: 'unknown-mutation-outcome',
  message: 'The connection failed after the mutation was sent. Outcome is unknown; inspect runtime state before retrying.',
}

const isMutation = (request: NativeRpcRequest): boolean =>
  request.namespace === 'session' ? ['create', 'fork', 'cancel', 'rename', 'prompt'].includes(request.method) : true

/** A failure after which the request may still have reached the runtime and been applied there. */
const mayHaveReachedRuntime = (error: TaggedFailure): boolean =>
  ['GatewayUnreachable', 'AuthenticationExpired', 'InvalidResponse', 'GatewayHttpError'].includes(error._tag)

const outsideContract = (request: NativeRpcRequest): NativeRpcResult =>
  isMutation(request)
    ? { ok: false, code: 'unknown-mutation-outcome', message: 'The runtime replied outside the expected contract. Inspect runtime state before retrying.' }
    : { ok: false, code: 'invalid-response', message: 'The runtime replied outside the expected contract.' }

/**
 * One native runtime request as the wire result. A failure the runtime reports is a `{ ok: false }` value; a
 * transport failure stays a failure, so a pooled caller can retire the connection before reporting it.
 */
const call = Effect.fnUntraced(function* (gateway: Gateway, request: NativeRpcRequest) {
  const args = yield* decodeArgs(request.args).pipe(Effect.orDie)
  return yield* gateway.run({ namespace: request.namespace, method: request.method, args }).pipe(
    Effect.map(raw => Option.getOrElse(decodeResult({ ok: true, value: raw }), () => outsideContract(request))),
    Effect.catchTag('RemoteRequestFailed', error => Effect.succeed<NativeRpcResult>({ ok: false, code: error.code, message: error.message })),
  )
})

/** The wire result for a request that failed: an unknown outcome for a mutation the runtime may have applied. */
const failureResult = (input: { readonly request: NativeRpcRequest; readonly error: TaggedFailure & { readonly message: string } }): NativeRpcResult => {
  if (isMutation(input.request) && mayHaveReachedRuntime(input.error)) return unknownOutcome
  return { ok: false, code: failureCodeOf(input.error), message: input.error.message }
}

/** `call` with every failure reported as a wire result, for a gateway outside the pool. */
const outcome = (gateway: Gateway, request: NativeRpcRequest) =>
  call(gateway, request).pipe(Effect.catch(error => Effect.succeed(failureResult({ request, error }))))

export class NativeRpc {
  static readonly isMutation = isMutation
  static readonly mayHaveReachedRuntime = mayHaveReachedRuntime
  static readonly call = call
  static readonly failureResult = failureResult
  static readonly outcome = outcome
}
