import * as Schema from 'effect/Schema'
import { MultiHostSchema } from './schema.js'
import { jsonValueSchema, nativeRpcResultSchema, type NativeRpcRequest, type NativeRpcResult } from './api.js'
import type { Gateway } from './legacy-runtime-promise.js'

const isMutation = (request: NativeRpcRequest): boolean =>
  request.namespace === 'session' ? ['create', 'fork', 'cancel', 'rename', 'prompt'].includes(request.method) : true

const mayHaveReachedRuntime = (code: string): boolean =>
  ['cancelled', 'gateway-unreachable', 'authentication-expired', 'invalid-response', 'gateway-http-error'].includes(code)

export const callNativeRpc = async (gateway: Gateway, request: NativeRpcRequest, signal?: AbortSignal): Promise<NativeRpcResult> => {
  const args = MultiHostSchema.decode(jsonValueSchema, request.args)
  const safeArgs = MultiHostSchema.decode(Schema.Record(Schema.String, jsonValueSchema), args)
  try {
    const outcome = await gateway.runSafe(request.namespace, request.method, safeArgs, signal)
    if (outcome.ok) {
      try {
        return MultiHostSchema.decode(nativeRpcResultSchema, { ok: true, value: MultiHostSchema.decode(jsonValueSchema, outcome.value) })
      } catch {
        return isMutation(request)
          ? {
              ok: false,
              code: 'unknown-mutation-outcome',
              message: 'The runtime replied outside the expected contract. Inspect runtime state before retrying.',
            }
          : { ok: false, code: 'invalid-response', message: 'The runtime replied outside the expected contract.' }
      }
    }
    const uncertain = isMutation(request) && mayHaveReachedRuntime(outcome.code)
    return {
      ok: false,
      code: uncertain ? 'unknown-mutation-outcome' : outcome.code,
      message: uncertain ? 'The connection failed after the mutation was sent. Outcome is unknown; inspect runtime state before retrying.' : outcome.message,
    }
  } catch {
    return isMutation(request)
      ? {
          ok: false,
          code: 'unknown-mutation-outcome',
          message: 'The connection failed after the mutation was sent. Outcome is unknown; inspect runtime state before retrying.',
        }
      : { ok: false, code: 'gateway-request-failed', message: 'The runtime request failed before a usable result arrived.' }
  }
}

export class NativeRpcModel {
  static readonly mayHaveReachedRuntime = mayHaveReachedRuntime
  static readonly call = callNativeRpc
}
