import { fileURLToPath } from 'node:url'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { start } from './runtime.js'
import { unsupportedMember } from './unsupported.js'

const fixture = (name: string) => fileURLToPath(new URL(`../tests/fixtures/${name}.mjs`, import.meta.url))
const entry = (name: string, options = '{}') => ({ specifier: fixture(name), options, enabled: true })

describe('OpenCode runtime', () => {
  it('loads a plugin with frozen options and awaits cleanup', async () => {
    const module = await import('../tests/fixtures/basic.mjs')
    module.events.length = 0
    const runtime = await start({ entries: [entry('basic', '{"answer":42}')], onUnsupported: 'report', domains: {} })
    expect(runtime.status()[0]).toMatchObject({ id: 'basic', state: 'loaded' })
    expect(module.events).toEqual([{ options: { answer: 42 }, frozen: true, app: { name: 'dsh', version: 'unknown', channel: 'opencode-compat' } }])
    await runtime.dispose()
    await runtime.dispose()
    expect(module.events).toHaveLength(2)
    expect(module.events[1]).toBe('cleanup')
  })

  it('disposes registrations when setup throws', async () => {
    let disposed = 0
    const tool = (input: import('./context.js').DomainInput) => ({
      transform: async () =>
        input.register({
          dispose: async () => {
            disposed += 1
          },
        }),
    })
    const runtime = await start({ entries: [entry('throwing')], onUnsupported: 'report', domains: { tool } })
    expect(runtime.status()[0]).toMatchObject({ state: 'failed', error: expect.stringContaining('setup exploded') })
    expect(disposed).toBe(1)
    await runtime.dispose()
    expect(disposed).toBe(1)
  })

  it('records unsupported calls in report mode and fails in fail mode', async () => {
    const report = await start({ entries: [entry('unsupported')], onUnsupported: 'report', domains: {} })
    expect(report.status()[0]).toMatchObject({ state: 'loaded', unsupported: [{ pluginId: 'unsupported', api: 'ctx.mcp.transform', count: 2 }] })
    const fail = await start({ entries: [entry('unsupported')], onUnsupported: 'fail', domains: {} })
    expect(fail.status()[0]).toMatchObject({ state: 'failed', error: expect.stringContaining('ctx.mcp.transform'), unsupported: [{ count: 1 }] })
    await report.dispose()
    await fail.dispose()
  })

  it('isolates injected domains and delegates unsupported members', async () => {
    const runtime = await start({
      entries: [entry('partial')],
      onUnsupported: 'report',
      domains: {
        session: input => ({
          hook: async (name: string) => {
            input.contributions.hooks.push(name)
            return input.register({ dispose: async () => undefined })
          },
          prompt: unsupportedMember({ ...input, path: 'session.prompt' }),
        }),
      },
    })
    expect(runtime.status()[0]).toMatchObject({
      state: 'loaded',
      contributions: { hooks: ['context'] },
      unsupported: [{ api: 'ctx.session.prompt', count: 1 }],
    })
    const independent = await start({ entries: [entry('partial')], onUnsupported: 'fail', domains: {} })
    expect(independent.status()[0]).toMatchObject({ state: 'failed', unsupported: [{ api: 'ctx.session.hook' }] })
    await runtime.dispose()
    await independent.dispose()
  })

  it('records a load span with identity and counts but no options', async () => {
    using recorder = recordSpans()
    const runtime = await start({ entries: [entry('basic', '{"private":"secret-value"}')], onUnsupported: 'report', domains: {} })
    expect(recorder.span('opencode-plugin load').attributes).toEqual({
      'opencode.plugin.id': 'basic',
      'opencode.plugin.state': 'loaded',
      'opencode.plugin.unsupported_count': 0,
    })
    expect(JSON.stringify(recorder.span('opencode-plugin load').attributes)).not.toContain('secret-value')
    await runtime.dispose()
  })

  it('rejects duplicate ids and invalid options while retaining disabled entries', async () => {
    const runtime = await start({
      entries: [entry('basic'), entry('basic'), entry('basic', '[]'), { ...entry('basic'), enabled: false }],
      onUnsupported: 'report',
      domains: {},
    })
    expect(runtime.status().map(item => item.state)).toEqual(['loaded', 'failed', 'failed', 'disabled'])
    expect(runtime.status()[1]?.error).toContain('Duplicate plugin id')
    expect(runtime.status()[2]?.error).toContain('Invalid options')
    await runtime.dispose()
  })
})
