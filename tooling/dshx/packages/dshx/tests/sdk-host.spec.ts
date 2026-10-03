import { Context } from '@deepseek-ai/cordis'
import { CommandRuntime } from '@deepseek-ai/dsh-commands'
type Agent = Parameters<CommandRuntime['find']>[0]
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { definePlugin, type PluginApi } from '../src/host/index.js'
import { createHostPlugin } from '../src/host/runtime.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'sdk/test': (value: number) => void
  }
}

describe('native SDK Host', () => {
  it('uses native commands, scoped context, events, and cleanup through reload and unload', async () => {
    const root = new Context()
    const provider = root.plugin(CommandRuntime)
    await provider
    const listener = vi.fn()
    const cleanup = vi.fn()
    let api: PluginApi<readonly ['commands']> | undefined
    const definition = definePlugin({
      id: 'example',
      uses: ['commands'],
      setup(value) {
        api = value
        value.commands.register({
          name: 'hello',
          description: 'Hello',
          handler: () => ({ kind: 'success', text: 'Hello' }),
        })
        value.events.on('sdk/test', listener)
        value.lifecycle.onDispose(cleanup)
      },
    })
    const plugin = createHostPlugin(definition, { packageId: '@test/example' })
    expect(plugin.inject).toEqual(['commands'])
    const fiber = root.plugin(plugin)
    await fiber
    const agent = { ctx: root } as Agent
    expect(api?.raw.ctx).toBe(fiber.ctx)
    expect(root.commands.find(agent, 'hello')).toBeDefined()
    root.emit('sdk/test', 42)
    expect(listener).toHaveBeenCalledWith(42)
    await fiber.restart()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(root.commands.find(agent, 'hello')).toBeDefined()
    await fiber.dispose()
    expect(root.commands.find(agent, 'hello')).toBeUndefined()
    root.emit('sdk/test', 99)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(2)
    await fiber.dispose()
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(() =>
      api?.commands.register({
        name: 'late',
        description: 'Late',
        handler: () => ({ kind: 'success' }),
      }),
    ).toThrow('inactive context')
    await provider.dispose()
  })

  it('only exposes declared capabilities and preserves native inference', () => {
    const definition = definePlugin({
      id: 'typed',
      uses: ['commands'],
      setup(api) {
        expectTypeOf(api.raw.ctx).toEqualTypeOf<Context>()
        api.commands.register({
          name: 'test',
          description: 'Test',
          handler(invocation) {
            expectTypeOf(invocation.rawInput).toEqualTypeOf<string>()
            return { kind: 'success' }
          },
        })
        api.events.on('sdk/test', value => {
          expectTypeOf(value).toEqualTypeOf<number>()
        })
        // @ts-expect-error Tools require uses: ['tools'].
        void api.tools
        // @ts-expect-error Unknown events are rejected.
        api.events.on('sdk/unknown', () => {})
      },
    })
    expect(definition.inject).toEqual(['commands'])
    expect(() => definePlugin({ id: 'Invalid_ID' })).toThrow('Plugin id')
  })
})
