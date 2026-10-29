// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContributedCommandsModel } from './contributed-commands.js'
import { PaletteApi } from './palette-api.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('contributed commands', () => {
  it('lists scoped, visible commands and withdraws them together', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dispose = ContributedCommandsModel.list(
      [
        { id: '@acme/plugin.open', title: 'Open Acme', keywords: ['acme'], keys: ['Mod+Shift+A'], run: () => {} },
        { id: '@acme/plugin.secret', title: 'Secret', hidden: true, run: () => {} },
        { id: 'unscoped.open', title: 'Unscoped', run: () => {} },
      ],
      new Map(),
    )
    expect(PaletteApi.getSnapshot().actions.map(action => action.id)).toEqual(['@acme/plugin.open'])
    expect(PaletteApi.getSnapshot().actions[0]).toMatchObject({ label: 'Open Acme', aliases: ['acme'], keys: ['Mod+Shift+A'], group: 'command' })
    dispose()
    expect(PaletteApi.getSnapshot().actions).toEqual([])
  })

  it('shows the keys a command answers to now and marks a suggested one', () => {
    const dispose = ContributedCommandsModel.list(
      [
        { id: '@acme/plugin.open', title: 'Open Acme', keys: ['Mod+B'], editable: true, suggested: true, run: () => {} },
        { id: '@acme/plugin.unbound', title: 'Unbound', keys: ['Mod+J'], editable: true, run: () => {} },
      ],
      new Map([
        ['@acme/plugin.open', ['Mod+Alt+O']],
        ['@acme/plugin.unbound', []],
      ]),
    )
    const [open, unbound] = PaletteApi.getSnapshot().actions
    expect(open).toMatchObject({ keys: ['Mod+Alt+O'], suggested: true })
    expect(unbound?.keys).toBeUndefined()
    dispose()
  })

  it('lists registry rows and leaves out an invalid or duplicate one without dropping the rest', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dispose = ContributedCommandsModel.listActions([
      { id: '@acme/plugin/open', label: 'Open', run: () => {} },
      { id: '@acme/plugin/open', label: 'Open again', run: () => {} },
      { id: 'unscoped', label: 'Unscoped', run: () => {} },
      { id: '@acme/plugin/close', label: 'Close', run: () => {} },
    ])
    expect(PaletteApi.getSnapshot().actions.map(action => action.id)).toEqual(['@acme/plugin/open', '@acme/plugin/close'])
    dispose()
    expect(PaletteApi.getSnapshot().actions).toEqual([])
  })

  it('marks a disabled command unavailable and runs an enabled one', async () => {
    const run = vi.fn()
    const disabled = ContributedCommandsModel.toPaletteAction({ id: '@acme/plugin.off', title: 'Off', enabled: false, run })
    const enabled = ContributedCommandsModel.toPaletteAction({ id: '@acme/plugin.on', title: 'On', run })
    const context = { thread: null, workspace: null, workspaces: [], themePreference: 'system' as const }
    expect(disabled?.isAvailable?.(context)).toBe(false)
    expect(enabled?.isAvailable?.(context)).toBe(true)
    await enabled?.run(context)
    expect(run).toHaveBeenCalledOnce()
  })
})
