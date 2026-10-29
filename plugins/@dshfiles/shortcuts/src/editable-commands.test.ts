import { describe, expect, it, vi } from 'vitest'
import { EditableCommands } from './editable-commands.js'

const hostRegistry = (taken: ReadonlySet<string> = new Set()) => {
  const listed = new Map<string, { readonly defaults: object; readonly regions: readonly string[]; readonly resolved: unknown }>()
  return {
    listed,
    register: (command: { id: string; defaults: object; regions: readonly string[]; resolve(): unknown }) => {
      if (taken.has(command.id) || listed.has(command.id)) throw new Error(`Duplicate shortcut command: ${command.id}`)
      listed.set(command.id, { defaults: command.defaults, regions: command.regions, resolved: command.resolve() })
      return () => listed.delete(command.id)
    },
  }
}

const open = { id: '@acme/plugin.open', title: 'Open Acme', keys: ['Mod+Shift+A'], editable: true, run: () => {} }

describe('EditableCommands', () => {
  it('lists only editable commands, unbound, under their Host id, and passes key presses back to the capture listener', () => {
    const registry = hostRegistry()
    const dispose = EditableCommands.register({ shortcuts: registry, commands: [open, { ...open, id: '@acme/plugin.fixed', editable: false }] })
    expect([...registry.listed.keys()]).toEqual(['acme-plugin.open'])
    expect(registry.listed.get('acme-plugin.open')).toEqual({ defaults: {}, regions: ['page', 'editable'], resolved: { status: 'pass' } })
    dispose()
    expect(registry.listed.size).toBe(0)
  })

  it('keeps page-scoped keys out of text fields and lists the rest when the Host refuses one', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const registry = hostRegistry(new Set(['acme-plugin.taken']))
    EditableCommands.register({
      shortcuts: registry,
      commands: [
        { ...open, id: '@acme/plugin.taken' },
        { ...open, scope: 'page' },
      ],
    })
    expect([...registry.listed.keys()]).toEqual(['acme-plugin.open'])
    expect(registry.listed.get('acme-plugin.open')?.regions).toEqual(['page'])
  })

  it('does nothing on a Host without a shortcut registry', () => {
    expect(EditableCommands.register({ shortcuts: undefined, commands: [open] })).toBeTypeOf('function')
  })
})
