import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isApiOwnerMissing, type ApiCallOptions } from '@dshfiles/dshx/api'
import type { JsonValue } from '@dshfiles/multi-host/api'
import { Schema } from 'effect'

type RepositoryApi = 'jujutsu' | 'jujutsu-composer'

/** The Host path to a mirrored thread's runtime, as this plugin needs it. */
export interface OwnerPort {
  readonly sessionRuntime: (
    input: { readonly sessionId: SessionId },
    options?: ApiCallOptions,
  ) => Promise<{ readonly ok: true; readonly runtimeId: string | null } | { readonly ok: false; readonly message: string }>
  readonly sessionRepositoryCall: (
    input: { readonly sessionId: string; readonly api: RepositoryApi; readonly method: never; readonly input: JsonValue },
    options?: ApiCallOptions,
  ) => Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly code: string; readonly message: string }>
}

const owners = new Map<string, Promise<string | null>>()

/**
 * The runtime that owns a Session, read once. A Session never changes owner, a Host without multi-host owns all of its
 * own, and a failed read says nothing, so it is asked again.
 */
const ownerOfSession = (port: Pick<OwnerPort, 'sessionRuntime'>, sessionId: SessionId, options?: ApiCallOptions): Promise<string | null> => {
  const known = owners.get(sessionId)
  if (known !== undefined) return known
  const read = port
    .sessionRuntime({ sessionId }, options)
    .then(result => {
      if (!result.ok) throw new Error(result.message)
      return result.runtimeId
    })
    .catch((error: unknown) => {
      if (error instanceof Error && isApiOwnerMissing(error)) return null
      owners.delete(sessionId)
      throw error
    })
  owners.set(sessionId, read)
  return read
}

/** Forget what was read, for a test that reuses a Session id. */
const forget = (): void => {
  owners.clear()
}

type LocalMethod = (input: JsonValue, options?: ApiCallOptions) => Promise<never>

/**
 * This Host's API client for a Session it owns, and the owning runtime's for a mirrored one: a mirrored thread's repository
 * exists only there. The Host checks every routed call against the thread's folder, and each reply is decoded with
 * this contract's output, so a runtime speaking another version is refused rather than shown.
 * @param input - this Host's client, its contract, the owner path and the Session.
 * @returns a client of the same shape.
 */
const routed = <Client extends object>(input: {
  readonly local: Client
  readonly api: RepositoryApi
  readonly methods: Readonly<Record<string, { readonly output?: Schema.ConstraintDecoder<unknown> }>>
  readonly owner: OwnerPort
  readonly sessionId: SessionId
}): Client => {
  // SAFETY: every name read below comes from this client's own contract, so each one is a method.
  const localMethods = input.local as Readonly<Record<string, LocalMethod | undefined>>
  const overrides = Object.fromEntries(
    Object.entries(input.methods).map(([method, definition]) => [
      method,
      async (call: JsonValue, options?: ApiCallOptions) => {
        const runtimeId = await ownerOfSession(input.owner, input.sessionId, options)
        if (runtimeId === null) {
          const local = localMethods[method]
          if (local === undefined) throw new TypeError(`This client has no ${method}.`)
          return local.call(input.local, call, options)
        }
        // SAFETY: `method` came from this contract, and the Host refuses any name outside its list.
        const result = await input.owner.sessionRepositoryCall({ sessionId: input.sessionId, api: input.api, method: method as never, input: call }, options)
        if (!result.ok) throw Object.assign(new Error(result.message), { remoteCode: result.code })
        if (definition.output === undefined) throw new TypeError(`${method} has no output contract.`)
        return Schema.decodeUnknownSync(definition.output)(result.value)
      },
    ]),
  )
  // SAFETY: the overrides replace this contract's methods with the same signatures; everything else stays on the client.
  return Object.assign(Object.create(input.local), overrides) as Client
}

export class OwnerRouting {
  static readonly ownerOf = ownerOfSession
  static readonly forget = forget
  static readonly api = routed
}
