import { MutationObserver, QueryClient } from '@dshfiles/plugin-ui/query'
import { describe, expect, it } from 'vitest'
import { ThreadRebaseMutation } from './thread-rebase-mutation.js'

const startLanding = (client: QueryClient, path: string): void => {
  const observer = new MutationObserver(client, {
    mutationKey: ThreadRebaseMutation.key,
    mutationFn: (_input: { readonly path: string }) => new Promise<never>(() => {}),
  })
  void observer.mutate({ path })
}

describe('thread rebase mutations', () => {
  it('reports a landing only for the workspace it lands', () => {
    const client = new QueryClient()
    startLanding(client, '/repo-threads/thread-a')
    expect(client.isMutating(ThreadRebaseMutation.at('/repo-threads/thread-a'))).toBe(1)
    expect(client.isMutating(ThreadRebaseMutation.at('/repo-threads/thread-b'))).toBe(0)
  })

  it('lists the paths of every pending landing', () => {
    const client = new QueryClient()
    startLanding(client, '/repo-threads/thread-a')
    startLanding(client, '/repo-threads/thread-b')
    const paths = client.getMutationCache().findAll({ mutationKey: ThreadRebaseMutation.key, status: 'pending' }).map(ThreadRebaseMutation.pathOf)
    expect(paths).toEqual(['/repo-threads/thread-a', '/repo-threads/thread-b'])
  })
})
