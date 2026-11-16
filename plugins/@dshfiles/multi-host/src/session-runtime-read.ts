import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ApiClient, ApiClientOutput } from '@dshfiles/dshx/api'
import { apiResource, resourceStore } from '@dshfiles/dshx/client'
import type { multiHostApi } from './api.js'

type Methods = (typeof multiHostApi)['methods']
type SessionRuntime = ApiClientOutput<Methods['sessionRuntime']>

/** A thread changes runtime only when it is moved, so a recent answer serves every reader on the page. */
const SESSION_RUNTIME_STALE_MS = 30_000

/**
 * Which runtime owns a thread, shared by every bundle on the page. The thread header's remote-host link and the model
 * picker both ask when a thread view mounts, at different moments of the same switch: joining only reads still in
 * flight sent the second one anyway.
 */
export const readSessionRuntime = (input: {
  readonly client: ApiClient<Methods>
  readonly sessionId: SessionId
  readonly signal?: AbortSignal | undefined
}): Promise<SessionRuntime> =>
  resourceStore().ensure<SessionRuntime>(
    apiResource({ client: input.client, method: 'sessionRuntime', input: { sessionId: input.sessionId }, options: { staleTime: SESSION_RUNTIME_STALE_MS } }),
    input.signal === undefined ? {} : { signal: input.signal },
  )
