import type { Context } from '@deepseek-ai/cordis'
import type { AnyApiMethodDefinition, ApiCallOptions, ApiCallResult, ApiClient, ApiContract, RegistryApiView } from './types.js'
import { aborted, error, isApiError, jsonBytes, ownerMissing, throwIfAborted, ContractViolation } from './common.js'
import { apiKey, apiRegistry, type ApiPayload } from './registry.js'
import { ApiRuntimeModel } from './runtime.js'

import { describeApis } from './host-runtime.js'

/**
 * Typed client for another plugin's API from Host code. Calls run in process
 * through the owner's dispatch, so they get the same schema validation, errors
 * and handler as a Client call. When the owner is not loaded every call fails
 * with an `unavailable` ApiError that `isApiOwnerMissing` recognizes.
 */
export function createHostApiClient<const Methods extends Record<string, AnyApiMethodDefinition>>(
  ctx: Context,
  contract: ApiContract<Methods>,
  callerPackageId = 'plugin',
): ApiClient<Methods> {
  const registry = apiRegistry(ctx)
  const owner = contract.owner ?? callerPackageId
  const call = async (name: string, input: ApiPayload, options?: ApiCallOptions): Promise<ApiPayload> => {
    try {
      throwIfAborted(options?.signal, contract.id, name)
      if (contract.methods[name] === undefined) throw error('contract', `Unknown API method ${name}.`, contract.id, name, false)
      const served = registry.apis.get(apiKey(owner, contract.id))
      if (served === undefined) throw ownerMissing(owner, contract.id, name)
      jsonBytes(input)
      const result = await served.dispatch(
        name,
        // Copies, so an in-process caller and the owner never share mutable objects, exactly as over Connection.
        { version: contract.version, input: structuredClone(input) },
        options?.signal ?? new AbortController().signal,
        { kind: 'plugin', packageId: callerPackageId },
        undefined,
      )
      throwIfAborted(options?.signal, contract.id, name)
      if (!result.ok) throw ApiRuntimeModel.errorFromRemote(result, contract.id, name)
      return structuredClone(result.value.output)
    } catch (cause) {
      if (isApiError(cause)) throw cause
      if (options?.signal?.aborted) throw aborted(contract.id, name, cause)
      if (cause instanceof ContractViolation) throw error('contract', cause.message, contract.id, name, false, cause)
      throw error('transport', cause instanceof Error ? cause.message : String(cause), contract.id, name, true, cause)
    }
  }
  const names = Object.keys(contract.methods)
  const methods = Object.fromEntries(names.map(name => [name, (input?: ApiPayload, options?: ApiCallOptions) => call(name, input, options)]))
  const safe = Object.fromEntries(
    names.map(name => [
      name,
      async (input?: ApiPayload, options?: ApiCallOptions): Promise<ApiCallResult<ApiPayload>> => {
        try {
          return { ok: true, value: await call(name, input, options) }
        } catch (cause) {
          return { ok: false, error: isApiError(cause) ? cause : error('transport', String(cause), contract.id, name, true, cause) }
        }
      },
    ]),
  )
  const client = { ...methods, safe }
  // SAFETY: every method key of the contract is populated above with the matching call shape.
  return client as ApiClient<Methods>
}

/** Whether the owner of `contract` currently serves it in this DSH process. */
export function isApiServed(ctx: Context, contract: Pick<ApiContract, 'id' | 'owner'>, callerPackageId = 'plugin'): boolean {
  return apiRegistry(ctx).apis.has(apiKey(contract.owner ?? callerPackageId, contract.id))
}

/** Every API served in this DSH process, with method descriptions and agent-tool names. */
export function listApis(ctx: Context): RegistryApiView[] {
  return describeApis(apiRegistry(ctx), {})
}
