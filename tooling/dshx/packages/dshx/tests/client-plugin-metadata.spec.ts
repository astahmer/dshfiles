import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Command } from '../src/client/app-services.js'
import { BrowserBroker } from '../src/client/broker.js'
import { defineClient } from '../src/client/index.js'
import { createClientPlugin } from '../src/client/runtime.js'

const contexts: Context[] = []
const testContext = (): Context => {
  const context = new Context()
  contexts.push(context)
  return context
}
afterEach(async () => {
  vi.unstubAllGlobals()
  BrowserBroker.reset()
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
})

describe('browser half metadata', () => {
  it('registers nothing on an operating system the plugin does not list', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const setup = vi.fn()
    createClientPlugin({ os: ['macos'], setup }, { packageId: '@test/mac-only' }).apply(testContext())
    expect(setup).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('macos only'))
    createClientPlugin({ os: ['macos', 'windows'], setup }, { packageId: '@test/desktop' }).apply(testContext())
    expect(setup).toHaveBeenCalledOnce()
  })

  it('refuses an os list with an unknown name', () => {
    expect(() => createClientPlugin({ os: ['beos'] }, { packageId: '@test/plugin' })).toThrow(expect.objectContaining({ code: 'DSHX2102' }))
  })

  it('prefixes short registry ids with the package id when asked, keeping full ids', () => {
    createClientPlugin(
      defineClient({
        prefixIds: true,
        setup: (_ctx, _decorate, metadata) => {
          metadata?.plugin?.add(Command, { id: 'open', title: 'Open', run: () => {} })
          metadata?.plugin?.add(Command, { id: '@test/plugin.legacy', title: 'Legacy', run: () => {} })
        },
      }),
      { packageId: '@test/plugin' },
    ).apply(testContext())
    createClientPlugin(
      defineClient({ setup: (_ctx, _decorate, metadata) => void metadata?.plugin?.add(Command, { id: 'plain', title: 'Plain', run: () => {} }) }),
      { packageId: '@test/other' },
    ).apply(testContext())
    expect(
      BrowserBroker.items(Command)
        .get()
        .map(command => command.id),
    ).toEqual(['@test/plugin.open', '@test/plugin.legacy', 'plain'])
  })
})
