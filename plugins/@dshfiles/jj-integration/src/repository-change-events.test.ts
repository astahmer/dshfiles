import { pluginQueryClient } from '@dshfiles/plugin-ui/query'
import { afterEach, describe, expect, it } from 'vitest'
import { followRepositoryChanges } from './repository-change-events.js'
import { threadAtQueryKey } from './thread-query-keys.js'

afterEach(() => pluginQueryClient().clear())

describe('repository change events (round three item 28)', () => {
  it('reads again the thread statuses of the workspaces a jj operation changed, and only those', async () => {
    const queryClient = pluginQueryClient()
    const keys = {
      a: threadAtQueryKey('/repo-threads/a', 'session-a'),
      b: threadAtQueryKey('/repo-threads/b'),
      c: threadAtQueryKey('/other-threads/c', 'session-c'),
    }
    for (const key of Object.values(keys)) await queryClient.prefetchQuery({ queryKey: key, queryFn: () => ({ thread: null }) })
    let deliver: (payload: { readonly paths: readonly string[] }) => void = () => undefined
    const stop = followRepositoryChanges({
      subscribe: onEvent => {
        deliver = onEvent
        return () => {
          deliver = () => undefined
        }
      },
      queryClient,
    })
    const invalidated = () => Object.entries(keys).flatMap(([name, key]) => (queryClient.getQueryState(key)?.isInvalidated === true ? [name] : []))
    expect(invalidated()).toEqual([])

    deliver({ paths: ['/repo-threads/a', '/repo-threads/b'] })
    expect(invalidated()).toEqual(['a', 'b'])

    stop()
    deliver({ paths: ['/other-threads/c'] })
    expect(invalidated()).toEqual(['a', 'b'])
  })
})
