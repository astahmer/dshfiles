import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from 'vitest'
import pickerHost from './host.js'
import { workspaceFolderPickerSettings } from './settings.js'

describe('workspace-folder-picker Host settings', () => {
  it('registers its settings namespace, so a project colour or display name can be saved', async () => {
    // Without the Host contribution the official Settings mirror lists no `dshfiles-workspace-folder-picker`
    // namespace, every `useSettings(...).set` is refused as `namespace-unregistered`, and Settings › Projects says
    // "This colour could not be saved." (upstream #287 shipped the contract without registering it).
    expect(pickerHost.settings).toEqual([workspaceFolderPickerSettings])

    const configured: { readonly auto: boolean }[] = []
    const host = await createTestHost()
    try {
      host.ctx.provide('settings', {
        configure: (options: { readonly auto: boolean }) => {
          configured.push(options)
          return () => undefined
        },
        describe: () => [{ ns: 'dshfiles-workspace-folder-picker', value: { projectNames: [], projectColors: [], projectParent: '' } }],
        update: async () => undefined,
        replace: async () => undefined,
      } as never)
      host.ctx.provide('subprocess', {} as never)
      host.ctx.provide('workspaceController', {} as never)
      host.ctx.provide('workspaceRegistry', { list: () => [] } as never)
      await host.mount(pickerHost, { packageId: '@dshfiles/workspace-folder-picker' })
      expect(configured).toEqual([{ auto: true }])
    } finally {
      await host.dispose()
    }
  })
})
