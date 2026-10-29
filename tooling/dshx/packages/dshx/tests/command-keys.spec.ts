import { afterEach, describe, expect, it } from 'vitest'
import { AppServicesModel, Command } from '../src/client/app-services.js'
import { BrowserBroker } from '../src/client/broker.js'
import { CommandChords } from '../src/client/command-chords.js'

afterEach(() => BrowserBroker.reset())

const catalogOf = (entries: readonly unknown[]) => {
  let snapshot = entries
  const listeners = new Set<() => void>()
  return {
    platform: 'macos',
    catalog: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    rebind: (next: readonly unknown[]) => {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

describe('CommandChords', () => {
  it('turns a chord into a Host binding and back', () => {
    expect(CommandChords.toBinding('Mod+Shift+K')).toEqual({ code: 'KeyK', modifiers: ['primary', 'shift'] })
    expect(CommandChords.toBinding('Alt+/')).toEqual({ code: 'Slash', modifiers: ['alt'] })
    expect(CommandChords.fromBinding({ binding: { code: 'KeyK', modifiers: ['meta', 'shift'] }, platform: 'macos' })).toBe('Mod+Shift+K')
    expect(CommandChords.fromBinding({ binding: { code: 'KeyK', modifiers: ['meta'] }, platform: 'linux' })).toBe('Meta+K')
  })

  it('refuses chords and ids it cannot map', () => {
    expect(CommandChords.toBinding('Hyper+K')).toBeUndefined()
    expect(CommandChords.toBinding('Mod+')).toBeUndefined()
    expect(CommandChords.shortcutId('@dshfiles/shortcuts.toggle-sidebar')).toBe('dshfiles-shortcuts.toggle-sidebar')
    expect(CommandChords.shortcutId('@acme/plugin')).toBeUndefined()
  })
})

describe('commands.keys', () => {
  it('answers default keys until the user rebinds an editable command, then follows the binding', () => {
    const native = catalogOf([])
    const commands = AppServicesModel.createCommands(() => native)
    BrowserBroker.add(Command, { id: '@acme/plugin.open', title: 'Open', keys: ['Mod+B'], editable: true, run: () => {} }, '@acme/plugin')
    BrowserBroker.add(Command, { id: '@acme/plugin.fixed', title: 'Fixed', keys: ['Mod+J'], run: () => {} }, '@acme/plugin')
    const seen: (readonly string[] | undefined)[] = []
    const stop = commands.keys.subscribe(() => seen.push(commands.keys.get().get('@acme/plugin.open')))
    expect(commands.keys.get().get('@acme/plugin.open')).toEqual(['Mod+B'])
    native.rebind([
      { id: 'acme-plugin.open', binding: { code: 'KeyO', modifiers: ['meta', 'alt'] }, modified: true },
      { id: 'acme-plugin.fixed', binding: { code: 'KeyX', modifiers: ['meta'] }, modified: true },
    ])
    expect(commands.keys.get().get('@acme/plugin.open')).toEqual(['Mod+Alt+O'])
    expect(commands.keys.get().get('@acme/plugin.fixed')).toEqual(['Mod+J'])
    native.rebind([{ id: 'acme-plugin.open', binding: null, modified: true }])
    expect(commands.keys.get().get('@acme/plugin.open')).toEqual([])
    stop()
    expect(seen).toEqual([['Mod+Alt+O'], []])
  })

  it('keeps default keys on a Host without a shortcut catalog', () => {
    const commands = AppServicesModel.createCommands(() => undefined)
    BrowserBroker.add(Command, { id: '@acme/plugin.open', title: 'Open', keys: ['Mod+B'], editable: true, run: () => {} }, '@acme/plugin')
    expect(commands.keys.get().get('@acme/plugin.open')).toEqual(['Mod+B'])
    expect(commands.keys.get()).toBe(commands.keys.get())
  })
})
