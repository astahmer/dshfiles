import { PluginApiError } from '@dshfiles/dshx/api'
import { Effect } from 'effect'

export const storageCall = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: cause =>
      new PluginApiError('Cleanup could not access session storage. Retry the preview; consult Host diagnostics if it persists.', {
        code: 'storage-unavailable',
        cause,
      }),
  })
