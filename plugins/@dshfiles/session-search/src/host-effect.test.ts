import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestHost } from '@dshfiles/dshx/testing'
import { afterEach, describe, expect, it } from 'vitest'
import plugin from './host.js'
import { SearchIndex } from './index-db.js'

let root = ''

afterEach(() => {
  if (root.length === 0) return
  rmSync(root, { recursive: true, force: true })
  root = ''
})

describe('session-search Effect Host bridge', () => {
  it('reads the owned worker index through the Effect API bridge', async () => {
    root = mkdtempSync(join(tmpdir(), 'session-search-host-effect-'))
    const host = await createTestHost()
    const sessionsRoot = join(root, 'sessions')
    const indexPath = join(root, 'owned.sqlite')
    const index = new SearchIndex(indexPath)
    const sessionId = 'session-eeeeeeee-0000-4000-8000-000000000000'
    index.commitBatch({
      header: { id: sessionId, version: 4, createdAt: 1, isSeeded: false },
      cursor: { logPath: join(root, 'log'), dev: '1', ino: '2', offset: 10, size: 10, mtimeNs: '3' },
      documents: [{ sessionId, seq: 1, type: 'user/message', time: 1, surface: 'current', text: 'owner index', truncated: false }],
      replace: false,
      now: 1,
    })
    index.close()
    host.ctx.provide('sessions', { list: () => [], get: () => undefined })
    host.ctx.provide('sessionPersistence', {
      config: { root: sessionsRoot },
      list: async () => [],
      open: async () => {
        throw new Error('the index reads Session logs directly')
      },
    })

    try {
      await host.mount(plugin, { packageId: '@dshfiles/session-search', config: { indexPath } })
      const response = await host.connection.requestApi({
        packageId: '@dshfiles/session-search',
        apiId: 'session-search',
        method: 'health',
        version: 1,
        input: {},
      })
      expect(await response.json()).toMatchObject({
        result: {
          ok: true,
          value: {
            output: { sessions: 1, documents: 1, ownsService: true },
            version: 1,
          },
        },
      })
    } finally {
      await host.dispose()
    }
  })
})
