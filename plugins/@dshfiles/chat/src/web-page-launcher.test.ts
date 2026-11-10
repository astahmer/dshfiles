import { Command, createSource, defineClientPlugin, Dialogs, MenuItem, Toasts, type PluginContext } from '@dshfiles/dshx/client'
import { createTestClient } from '@dshfiles/dshx/testing'
import { describe, expect, it } from 'vitest'
import { registerWebPageLauncher } from './web-page-launcher.ts'

describe('web page launcher', () => {
  it('registers and withdraws both actions together and shares the prompt and open behavior', async () => {
    const client = await createTestClient()
    const available = createSource(false)
    const opened: string[] = []
    const prompts: string[] = []
    const warnings: string[] = []
    let answer: string | undefined
    let api: PluginContext | undefined
    try {
      const mounted = await client.mount(
        defineClientPlugin({
          id: 'web-launcher-test',
          uses: ['ui'],
          setup(plugin) {
            api = plugin
            plugin.provide(Dialogs, {
              confirm: async () => false,
              alert: async () => undefined,
              prompt: async input => {
                prompts.push(`${input.title}|${input.placeholder}`)
                return answer
              },
              select: async () => undefined,
            })
            plugin.provide(Toasts, {
              show: input => {
                warnings.push(input.title)
                return () => undefined
              },
            })
            registerWebPageLauncher({
              plugin,
              browser: {
                available,
                open: url => {
                  opened.push(url)
                  return url.startsWith('https://')
                },
              },
            })
          },
        }),
      )
      if (api === undefined) throw new Error('Plugin did not mount')
      const commands = api.list(Command)
      const items = api.list(MenuItem)
      expect(commands.get()).toHaveLength(0)
      expect(items.get()).toHaveLength(0)
      available.set(true)
      await Promise.resolve()
      expect(commands.get()).toHaveLength(1)
      expect(items.get()).toHaveLength(1)
      const command = commands.get()[0]
      const item = items.get()[0]
      expect(command?.title).toBe('Open web page…')
      expect(item?.title).toBe(command?.title)
      expect(item?.menu).toBe('workbench.new-view')
      expect(command?.run).toBe(item?.run)
      answer = 'example.com'
      item?.run()
      await Promise.resolve()
      answer = 'https://example.org/path'
      command?.run()
      await Promise.resolve()
      answer = undefined
      command?.run()
      await Promise.resolve()
      answer = 'ftp://example.org'
      command?.run()
      await Promise.resolve()
      expect(opened).toEqual(['https://example.com', 'https://example.org/path', 'ftp://example.org'])
      expect(prompts).toEqual(Array(4).fill('Open web page|https://example.com'))
      expect(warnings).toEqual(['Could not open that page'])
      available.set(false)
      await Promise.resolve()
      expect(commands.get()).toHaveLength(0)
      expect(items.get()).toHaveLength(0)
      available.set(true)
      await Promise.resolve()
      await mounted.dispose()
      expect(commands.get()).toHaveLength(0)
      expect(items.get()).toHaveLength(0)
    } finally {
      await client.dispose()
    }
  })
})
