import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isApiOwnerMissing, type ApiCallOptions } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import { jjIntegrationApi } from './api.js'

type Local = {
  readonly threadAt: (input: { readonly path: string; readonly sessionId?: string }, options?: ApiCallOptions) => Promise<ThreadAtResult>
  readonly land: (input: { readonly path: string; readonly sessionId?: string }, options?: ApiCallOptions) => Promise<LandResult>
  readonly queueLand: (input: { readonly path: string; readonly sessionId?: string }, options?: ApiCallOptions) => Promise<QueueLandResult>
  readonly cancelQueuedLand: (input: { readonly path: string }, options?: ApiCallOptions) => Promise<CancelQueuedLandResult>
}

const { cancelQueuedLand, land, queueLand, threadAt } = jjIntegrationApi.methods
type OutputOf<Method extends { readonly output?: Schema.Top }> = NonNullable<Method['output']>['Type']
type ThreadAtResult = OutputOf<typeof threadAt>
type LandResult = OutputOf<typeof land>
type QueueLandResult = OutputOf<typeof queueLand>
type CancelQueuedLandResult = OutputOf<typeof cancelQueuedLand>

/** The Host path to a mirrored thread's runtime, resolved per Session. */
export interface SessionThreadRemote {
  readonly sessionRuntime: (
    input: { readonly sessionId: SessionId },
    options?: ApiCallOptions,
  ) => Promise<{ readonly ok: true; readonly runtimeId: string | null } | { readonly ok: false; readonly message: string }>
  readonly sessionJjCall: (
    input: {
      readonly sessionId: string
      readonly method: 'threadAt' | 'land' | 'queueLand' | 'cancelQueuedLand'
      readonly input: { readonly path: string; readonly sessionId?: string }
    },
    options?: ApiCallOptions,
  ) => Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly code: string; readonly message: string }>
}

/** A remote refusal keeps the owner's code in the field the integration recovery reads. */
const refusal = (failure: { readonly code: string; readonly message: string }): Error => Object.assign(new Error(failure.message), { remoteCode: failure.code })

/**
 * The JJ thread actions of one Session, on whichever Host owns it. A local Session uses this Host's API unchanged; a
 * mirrored one goes to its owning runtime, whose folder means nothing on this machine. Ownership is read once per
 * Session, and a Host without multi-host has only local Sessions.
 * @param input - this Host's API, the multi-host API and the Session.
 * @returns the same four calls the thread control makes.
 */
export const sessionThreadApi = (input: { readonly local: Local; readonly remote: SessionThreadRemote; readonly sessionId: SessionId }): Local => {
  const { local, remote, sessionId } = input
  let owner: Promise<string | null> | undefined
  const ownerOf = (options?: ApiCallOptions): Promise<string | null> => {
    if (owner !== undefined) return owner
    const read = remote
      .sessionRuntime({ sessionId }, options)
      .then(result => {
        if (!result.ok) throw new Error(result.message)
        return result.runtimeId
      })
      .catch((error: unknown) => {
        if (error instanceof Error && isApiOwnerMissing(error)) return null
        // A failed read says nothing about the owner, so the next call asks again.
        owner = undefined
        throw error
      })
    owner = read
    return read
  }
  const call = async <Value>(
    method: 'threadAt' | 'land' | 'queueLand' | 'cancelQueuedLand',
    action: { readonly path: string; readonly sessionId?: string },
    output: Schema.ConstraintDecoder<Value> | undefined,
    options: ApiCallOptions | undefined,
  ): Promise<Value> => {
    if (output === undefined) throw new TypeError('This JJ thread method has no output contract.')
    const result = await remote.sessionJjCall({ sessionId, method, input: action }, options)
    if (!result.ok) throw refusal(result)
    // The contract's own output: a runtime speaking another version is refused, not shown.
    return Schema.decodeUnknownSync(output)(result.value)
  }
  return {
    threadAt: async (action, options) =>
      (await ownerOf(options)) === null ? local.threadAt(action, options) : call('threadAt', action, threadAt.output, options),
    land: async (action, options) => ((await ownerOf(options)) === null ? local.land(action, options) : call('land', action, land.output, options)),
    queueLand: async (action, options) =>
      (await ownerOf(options)) === null ? local.queueLand(action, options) : call('queueLand', action, queueLand.output, options),
    cancelQueuedLand: async (action, options) =>
      (await ownerOf(options)) === null ? local.cancelQueuedLand(action, options) : call('cancelQueuedLand', action, cancelQueuedLand.output, options),
  }
}
