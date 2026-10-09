import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { createTempHome, createTestRuntime } from './testing/dsh-fixtures.ts'
import { createMemoryToolHandlers } from './tools.ts'

const home = createTempHome()
afterAll(() => home.cleanup())

let databases = 0
const freshDatabase = (): string => join(home.directory, `memory-${databases++}`, 'optmem.db')

describe('full mode capabilities', () => {
  it('stays in compatibility mode on stock DSH', async () => {
    const { runtime } = createTestRuntime({ databasePath: freshDatabase(), settings: { mode: 'full' } })
    await runtime.start()
    const status = await createMemoryToolHandlers(() => runtime).status(undefined)
    expect(status.summary).toContain('replaceContext=no resetPerTurn=no')
    expect(status.summary).toContain('mode full unsupported → compatibility')
    await runtime.stop()
  })

  it('reports full mode when the fork request-messages hook is present', async () => {
    const { runtime } = createTestRuntime({ databasePath: freshDatabase(), settings: { mode: 'full' }, requestMessagesHook: true })
    await runtime.start()
    const status = await createMemoryToolHandlers(() => runtime).status(undefined)
    expect(status.summary).toContain('replaceContext=yes resetPerTurn=yes')
    expect(status.summary).toContain('state ready; mode full\n')
    await runtime.stop()
  })
})
