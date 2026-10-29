import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { registerRepositoryBatch } from './repository-batch.js'

describe('repository batch', () => {
  it('reports one row per unique path and keeps failures local', async () => {
    const asked: string[] = []
    const results = await registerRepositoryBatch({
      paths: ['/repo-a', '/not-a-repo', '/repo-b', '/repo-a'],
      register: async path => {
        asked.push(path)
        if (path === '/not-a-repo') throw new Error('no repository here')
        return { repoId: `id:${path}`, root: path }
      },
    })
    assert.deepEqual(asked.sort(), ['/not-a-repo', '/repo-a', '/repo-b'])
    assert.deepEqual(results, [
      { path: '/repo-a', repoId: 'id:/repo-a', root: '/repo-a' },
      { path: '/not-a-repo', repoId: null, root: null },
      { path: '/repo-b', repoId: 'id:/repo-b', root: '/repo-b' },
    ])
  })

  it('bounds how many repositories resolve at once', async () => {
    let running = 0
    let peak = 0
    const paths = Array.from({ length: 9 }, (_, index) => `/repo-${String(index)}`)
    await registerRepositoryBatch({
      paths,
      concurrency: 3,
      register: async path => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise(resolve => setTimeout(resolve, 1))
        running -= 1
        return { repoId: path, root: path }
      },
    })
    assert.equal(peak, 3)
  })
})
