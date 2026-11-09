// @vitest-environment jsdom
import type { CommandItem } from '@dshfiles/dshx/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContributedCommandsModel } from './contributed-commands.js'
import { PaletteApi } from './palette-api.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const list = (commands: readonly CommandItem[], keys: ReadonlyMap<string, readonly string[]>): (() => void) => {
  const rows = PaletteApi.openRows()
  rows.set(ContributedCommandsModel.createCommandRows()(commands, keys))
  return rows.dispose
}

describe('contributed commands', () => {
  it('lists scoped, visible commands and withdraws them together', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dispose = list(
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
    const dispose = list(
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
    const rows = PaletteApi.openRows()
    rows.set([
      { id: '@acme/plugin/open', label: 'Open', run: () => {} },
      { id: '@acme/plugin/open', label: 'Open again', run: () => {} },
      { id: 'unscoped', label: 'Unscoped', run: () => {} },
      { id: '@acme/plugin/close', label: 'Close', run: () => {} },
    ])
    expect(PaletteApi.getSnapshot().actions.map(action => action.id)).toEqual(['@acme/plugin/open', '@acme/plugin/close'])
    rows.dispose()
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

  it('re-lists nothing when the shortcut catalog changes without moving a key', () => {
    const commands: CommandItem[] = [
      { id: '@acme/plugin.open', title: 'Open', keys: ['Mod+O'], run: () => {} },
      { id: '@acme/plugin.close', title: 'Close', keys: ['Mod+W'], run: () => {} },
    ]
    const rows = PaletteApi.openRows()
    const rowsOf = ContributedCommandsModel.createCommandRows()
    rows.set(rowsOf(commands, new Map([['@acme/plugin.open', ['Mod+O']]])))
    const listed = PaletteApi.getSnapshot()
    let notifications = 0
    const unsubscribe = PaletteApi.subscribe(() => notifications++)
    rows.set(rowsOf(commands, new Map([['@acme/plugin.open', ['Mod+O']]])))
    expect(notifications).toBe(0)
    expect(PaletteApi.getSnapshot()).toBe(listed)
    rows.set(rowsOf(commands, new Map([['@acme/plugin.open', ['Mod+Alt+O']]])))
    expect(notifications).toBe(1)
    expect(PaletteApi.getSnapshot().actions.map(action => action.keys)).toEqual([['Mod+Alt+O'], ['Mod+W']])
    expect(PaletteApi.getSnapshot().actions[1]).toBe(listed.actions[1])
    unsubscribe()
    rows.dispose()
  })

  it('replaces a whole contributed row set in one change and keeps its place among other rows', () => {
    const first = PaletteApi.openRows()
    const disposeSingle = PaletteApi.registerAction({ id: '@acme/plugin/single', label: 'Single', run: () => {} })
    let notifications = 0
    const unsubscribe = PaletteApi.subscribe(() => notifications++)
    first.set([
      { id: '@acme/plugin/a', label: 'A', run: () => {} },
      { id: '@acme/plugin/b', label: 'B', run: () => {} },
      { id: '@acme/plugin/c', label: 'C', run: () => {} },
    ])
    expect(notifications).toBe(1)
    expect(PaletteApi.getSnapshot().actions.map(action => action.id)).toEqual(['@acme/plugin/a', '@acme/plugin/b', '@acme/plugin/c', '@acme/plugin/single'])
    unsubscribe()
    disposeSingle()
    first.dispose()
    expect(PaletteApi.getSnapshot().actions).toEqual([])
  })
})
