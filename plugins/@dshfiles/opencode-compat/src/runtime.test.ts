import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { domainTable } from './context.js'
import { start } from './runtime.js'

const fixture = (name: string) => fileURLToPath(new URL(`../tests/fixtures/${name}.mjs`, import.meta.url))
const entry = (name: string, options = '{}') => ({ specifier: fixture(name), options, enabled: true })

afterEach(() => {
  delete domainTable.tool
})

describe('OpenCode runtime', () => {
  it('loads a plugin with frozen options and awaits cleanup', async () => {
    const module = await import('../tests/fixtures/basic.mjs')
    module.events.length = 0
    const runtime = await start({ entries: [entry('basic', '{"answer":42}')], onUnsupported: 'report' })
    expect(runtime.status()[0]).toMatchObject({ id: 'basic', state: 'loaded' })
    expect(module.events).toEqual([{ options: { answer: 42 }, frozen: true, app: { name: 'dsh', version: 'unknown', channel: 'opencode-compat' } }])
    await runtime.dispose()
    await runtime.dispose()
    expect(module.events).toHaveLength(2)
    expect(module.events[1]).toBe('cleanup')
  })

  it('disposes registrations when setup throws', async () => {
    let disposed = 0
    domainTable.tool = input => ({
      transform: async () =>
        input.register({
          dispose: async () => {
            disposed += 1
          },
        }),
    })
    const runtime = await start({ entries: [entry('throwing')], onUnsupported: 'report' })
    expect(runtime.status()[0]).toMatchObject({ state: 'failed', error: expect.stringContaining('setup exploded') })
    expect(disposed).toBe(1)
    await runtime.dispose()
    expect(disposed).toBe(1)
  })

  it('records unsupported calls in report mode and fails in fail mode', async () => {
    const report = await start({ entries: [entry('unsupported')], onUnsupported: 'report' })
    expect(report.status()[0]).toMatchObject({ state: 'loaded', unsupported: [{ pluginId: 'unsupported', api: 'ctx.mcp.transform', count: 2 }] })
    const fail = await start({ entries: [entry('unsupported')], onUnsupported: 'fail' })
    expect(fail.status()[0]).toMatchObject({ state: 'failed', error: expect.stringContaining('ctx.mcp.transform'), unsupported: [{ count: 1 }] })
    await report.dispose()
    await fail.dispose()
  })

  it('rejects duplicate ids and invalid options while retaining disabled entries', async () => {
    const runtime = await start({
      entries: [entry('basic'), entry('basic'), entry('basic', '[]'), { ...entry('basic'), enabled: false }],
      onUnsupported: 'report',
    })
    expect(runtime.status().map(item => item.state)).toEqual(['loaded', 'failed', 'failed', 'disabled'])
    expect(runtime.status()[1]?.error).toContain('Duplicate plugin id')
    expect(runtime.status()[2]?.error).toContain('Invalid options')
    await runtime.dispose()
  })
})
