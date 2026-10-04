import type { ApiError, ApiErrorKind } from './types.js'

const MAX_JSON_BYTES = 1024 * 1024
const API_ERROR = Symbol('dshx.api-error')

export class ContractViolation extends Error {
  override readonly name = 'ContractViolation'
}

class InternalApiError extends Error {
  override readonly name = 'ApiError' as const
  readonly [API_ERROR] = true

  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly apiId: string,
    readonly method: string,
    readonly retryable: boolean,
    readonly remoteCode?: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options)
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof InternalApiError || (typeof value === 'object' && value !== null && (value as Record<PropertyKey, unknown>)[API_ERROR] === true)
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function apiChannel(packageId: string, apiId: string): string {
  return `/dshx-${stableHash(`${packageId}\0${apiId}`)}`
}

export function jsonBytes(value: unknown): number {
  if (value === undefined) return 0
  const active = new Set<object>()
  const visit = (item: unknown, depth: number): void => {
    if (depth > 100) throw new ContractViolation('API payload exceeds 100 levels of JSON nesting.')
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (typeof item !== 'object' || item === null)
      throw new ContractViolation('API payload must contain only JSON values; undefined is permitted only for a void root.')
    if (active.has(item)) throw new ContractViolation('API payload contains a cycle.')
    const prototype = Object.getPrototypeOf(item)
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null)
      throw new ContractViolation('API payload must use plain objects and arrays.')
    if (Object.getOwnPropertySymbols(item).length > 0) throw new ContractViolation('API payload cannot contain symbol properties.')
    active.add(item)
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index += 1) visit(item[index], depth + 1)
    } else {
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) {
        if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable)
          throw new ContractViolation('API payload cannot contain accessors or non-enumerable properties.')
        visit(descriptor.value, depth + 1)
      }
    }
    active.delete(item)
  }
  visit(value, 0)
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch (cause) {
    throw new ContractViolation(`API payload is not JSON serializable: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (encoded === undefined) throw new ContractViolation('API payload must be JSON serializable.')
  const bytes = new TextEncoder().encode(encoded).byteLength
  if (bytes > MAX_JSON_BYTES) throw new ContractViolation(`API payload exceeds ${MAX_JSON_BYTES} bytes.`)
  return bytes
}

export async function validate(schema: unknown, value: unknown): Promise<unknown> {
  if (schema === undefined) return value
  const validator = (
    schema as {
      '~standard'?: {
        validate?: (input: unknown) => unknown | Promise<unknown>
      }
    }
  )['~standard']?.validate
  if (typeof validator !== 'function') throw new ContractViolation('API schema does not implement Standard Schema validate().')
  const result = await validator(value)
  if (result === undefined || typeof result !== 'object' || result === null) {
    throw new ContractViolation('API schema returned an invalid Standard Schema result.')
  }
  if ((result as { readonly issues?: unknown }).issues !== undefined) {
    throw new ContractViolation('API schema validation failed.')
  }
  if (!Object.hasOwn(result, 'value')) throw new ContractViolation('API schema success result is missing value.')
  return (result as { readonly value: unknown }).value
}

export function error(
  kind: ApiError['kind'],
  message: string,
  apiId: string,
  method: string,
  retryable: boolean,
  cause?: unknown,
  remoteCode?: string,
): ApiError {
  return new InternalApiError(kind, message, apiId, method, retryable, remoteCode, cause === undefined ? undefined : { cause }) as unknown as ApiError
}

export function aborted(apiId: string, method: string, cause?: unknown): ApiError {
  return error('aborted', 'API request was aborted.', apiId, method, false, cause, 'aborted')
}

export function throwIfAborted(signal: AbortSignal | undefined, apiId: string, method: string): void {
  if (signal?.aborted === true) throw aborted(apiId, method, signal.reason)
}
