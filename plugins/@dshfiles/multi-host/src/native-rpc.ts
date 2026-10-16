import { z } from 'zod'
import { jsonValueSchema, nativeRpcResultSchema, type NativeRpcRequest, type NativeRpcResult } from './api.js'
import type { Gateway } from './connectors/gateway.js'

const isMutation = (request: NativeRpcRequest): boolean =>
  request.namespace === 'session' ? ['create', 'fork', 'cancel', 'rename', 'prompt'].includes(request.method) : true

const mayHaveReachedRuntime = (code: string): boolean =>
  ['cancelled', 'gateway-unreachable', 'authentication-expired', 'invalid-response', 'gateway-http-error'].includes(code)

const callNativeRpc = async (gateway: Gateway, request: NativeRpcRequest, signal?: AbortSignal): Promise<NativeRpcResult> => {
  const args = jsonValueSchema.parse(request.args)
  const safeArgs = z.record(z.string(), jsonValueSchema).parse(args)
  try {
    const outcome = await gateway.runSafe(request.namespace, request.method, safeArgs, signal)
    if (outcome.ok) {
      try {
        return nativeRpcResultSchema.parse({ ok: true, value: jsonValueSchema.parse(outcome.value) })
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
