import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ApiError, ApiErrorKind } from './types.js'

const MAX_JSON_BYTES = 1024 * 1024
export const API_ERROR = Symbol('dshx.api-error')

export class ContractViolation extends Error {
  override readonly name = 'ContractViolation'
}

const PLUGIN_API_ERROR = Symbol.for('dshx.plugin-api-error')
const PLUGIN_API_ERROR_CODE = /^[a-z][a-z0-9-]{0,63}$/
const RESERVED_REMOTE_CODES = new Set(['aborted', 'bad-request', 'contract', 'internal'])
const MAX_PLUGIN_ERROR_MESSAGE = 500

/**
 * A failure a Host API handler means the user to read. Its message and code
 * reach the Client as an ApiError with kind `remote`; any other thrown value
 * stays a generic internal failure and is only logged on the Host.
 */
export class PluginApiError extends Error {
  override readonly name = 'PluginApiError'
  readonly [PLUGIN_API_ERROR] = true
  /** Stable machine code the Client reads as `ApiError.remoteCode`; reserved or malformed codes become `plugin`. */
  readonly code: string

  constructor(message: string, options: { readonly code?: string; readonly cause?: unknown } = {}) {
    super(message.slice(0, MAX_PLUGIN_ERROR_MESSAGE), options.cause === undefined ? undefined : { cause: options.cause })
    const code = options.code
    this.code = code !== undefined && PLUGIN_API_ERROR_CODE.test(code) && !RESERVED_REMOTE_CODES.has(code) ? code : 'plugin'
  }
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

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** The first few Standard Schema issues as `path: message`, so a caller (often the agent) can fix its input. */
function describeIssues(issues: readonly StandardSchemaV1.Issue[]): string {
  if (issues.length === 0) return ''
  const described = issues.slice(0, 3).map(issue => {
    const path = (issue.path ?? []).map(segment => String(segment instanceof Object ? segment.key : segment)).join('.')
    const message = issue.message.slice(0, 200)
    return path === '' ? message : `${path}: ${message}`
  })
  return `: ${described.join('; ')}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ''}`
}

const OWNER_MISSING = 'owner-missing'

export class ApiProtocolModel {
  static isPluginApiError(value: unknown): value is PluginApiError {
    return (
      value instanceof PluginApiError || (typeof value === 'object' && value !== null && (value as Record<PropertyKey, unknown>)[PLUGIN_API_ERROR] === true)
    )
  }

  static isApiError(value: unknown): value is ApiError {
    return value instanceof InternalApiError || (typeof value === 'object' && value !== null && (value as Record<PropertyKey, unknown>)[API_ERROR] === true)
  }

  static apiChannel(packageId: string, apiId: string): string {
    return `/dshx-${stableHash(`${packageId}\0${apiId}`)}`
  }

  static jsonBytes(value: unknown): number {
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

  static async validate(schema: unknown, value: unknown): Promise<unknown> {
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
    const issues = (result as { readonly issues?: unknown }).issues
    if (issues !== undefined) {
      throw new ContractViolation(`API schema validation failed${describeIssues(Array.isArray(issues) ? issues : [])}.`)
    }
    if (!Object.hasOwn(result, 'value')) throw new ContractViolation('API schema success result is missing value.')
    return (result as { readonly value: unknown }).value
  }

  static error(kind: ApiError['kind'], message: string, apiId: string, method: string, retryable: boolean, cause?: unknown, remoteCode?: string): ApiError {
    return new InternalApiError(kind, message, apiId, method, retryable, remoteCode, cause === undefined ? undefined : { cause })
  }

  static aborted(apiId: string, method: string, cause?: unknown): ApiError {
    return ApiProtocolModel.error('aborted', 'API request was aborted.', apiId, method, false, cause, 'aborted')
  }

  static throwIfAborted(signal: AbortSignal | undefined, apiId: string, method: string): void {
    if (signal?.aborted === true) throw ApiProtocolModel.aborted(apiId, method, signal.reason)
  }

  /** The owner of an API is not loaded in this DSH process (or, from a Client, its routes do not exist). */
  static ownerMissing(owner: string, apiId: string, method: string, cause?: unknown): ApiError {
    return ApiProtocolModel.error('unavailable', `${owner} is not loaded, so ${apiId}.${method} is unavailable.`, apiId, method, true, cause, OWNER_MISSING)
  }

  /**
   * Whether a call failed only because the plugin that owns the API is not
   * loaded. Stop polling and hide the feature instead of reporting an error.
   */
  static isApiOwnerMissing(value: Error | null | undefined): boolean {
    return ApiProtocolModel.isApiError(value) && value.kind === 'unavailable' && value.remoteCode === OWNER_MISSING
  }
}

export const isApiError = ApiProtocolModel.isApiError
export const isApiOwnerMissing = ApiProtocolModel.isApiOwnerMissing
