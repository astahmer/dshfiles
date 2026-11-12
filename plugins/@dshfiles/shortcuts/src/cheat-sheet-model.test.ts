import type { CommandItem } from '@dshfiles/dshx/client'
import { describe, expect, it, vi } from 'vitest'
import { CheatSheetModel } from './cheat-sheet-model.js'
import { CommandBindings } from './command-bindings.js'

const command = (input: Partial<CommandItem> & Pick<CommandItem, 'id' | 'title'>): CommandItem => ({ run: () => {}, ...input })

describe('CheatSheetModel.sections', () => {
  const commands = [
    command({ id: '@a/x.next', title: 'Next', keys: ['J'], scope: 'list' }),
    command({ id: '@b/y.next', title: 'Next', keys: ['J'], scope: 'list' }),
    command({
      id: '@a/x.choice',
      title: 'Answer with a choice',
      keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
      scope: 'triage',
    }),
    command({
      id: '@a/x.inbox',
      title: 'Go to Inbox',
      keys: ['G I'],
      scope: 'not-typing',
      section: 'Go to',
    }),
    command({ id: '@a/x.palette', title: 'Command palette', keys: ['Mod+K'] }),
    command({
      id: '@a/x.off',
      title: 'Disabled',
      keys: ['Mod+D'],
      enabled: false,
    }),
    command({ id: '@a/x.unbound', title: 'Unbound' }),
  ]

  it('groups bound keys by scope or section, in reading order, and collapses duplicates', () => {
    const sections = CheatSheetModel.sections({
      commands,
      keys: new Map(),
      host: [],
      singleKeys: true,
    })
    expect(sections.map(section => section.title)).toEqual(['Global', 'Go to', 'Lists', 'Triage'])
    expect(sections.find(section => section.title === 'Lists')?.rows).toHaveLength(1)
    expect(sections.find(section => section.title === 'Triage')?.rows[0]?.keys).toEqual(['1–9'])
  })

  it('drops character keys while single-key shortcuts are off', () => {
    const sections = CheatSheetModel.sections({
      commands,
      keys: new Map(),
      host: [],
      singleKeys: false,
    })
    expect(sections.map(section => section.title)).toEqual(['Global'])
  })

  it('lists Host chords under App unless a command already names them, and follows user rebindings', () => {
    const sections = CheatSheetModel.sections({
      commands,
      keys: new Map([['@a/x.palette', ['Mod+Shift+K']]]),
      host: [
        {
          id: 'commandPalette.open',
          label: 'Command palette',
          keys: ['⌘', '⇧', 'P'],
        },
        {
          id: 'threadSidebar.search',
          label: 'Search threads',
          keys: ['⌘', 'P'],
        },
      ],
      singleKeys: true,
    })
    expect(sections.find(section => section.title === 'Global')?.rows[0]?.keys).toEqual(['Mod+Shift+K'])
    expect(sections.find(section => section.title === 'App')?.rows.map(row => row.label)).toEqual(['Search threads'])
  })
})

describe('CommandBindings.toBindings', () => {
  it('binds parsable keys by scope, passes the trigger, and warns once about the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const run = vi.fn()
    const items = [
      command({
        id: '@a/x.done',
        title: 'Done',
        keys: ['E', 'Hyper+E'],
        scope: 'list',
        run,
      }),
    ]
    const bindings = CommandBindings.toBindings(items, new Map())
    CommandBindings.toBindings(items, new Map())
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.scope).toBe('list')
    expect(warn).toHaveBeenCalledOnce()
    const event = new KeyboardEvent('keydown')
    bindings[0]?.run({ keys: 'E', event })
    expect(run).toHaveBeenCalledWith({ keys: 'E', event })
    warn.mockRestore()
  })

  it('declines a disabled command so the key reaches its target', () => {
    const [bound] = CommandBindings.toBindings(
      [
        command({
          id: '@a/x.off',
          title: 'Off',
          keys: ['Mod+K'],
          enabled: false,
        }),
      ],
      new Map(),
    )
    expect(bound?.run({ keys: 'Mod+K', event: new KeyboardEvent('keydown') })).toBe(false)
  })
})

describe('Host rows in the cheat sheet (productivity pass Q5)', () => {
  it('speak the glossary and leave out what a command already lists, keeping the rest', () => {
    const sections = CheatSheetModel.sections({
      commands: [
        command({ id: '@a/x.new', title: 'New thread', keys: ['Mod+Shift+O'] }),
        command({ id: '@a/x.sheet', title: 'Keyboard shortcuts', keys: ['Mod+/'] }),
        command({ id: '@a/x.sidebar', title: 'Toggle sidebar', keys: ['Mod+B'] }),
      ],
      keys: new Map(),
      host: [
        { id: 'session.new', label: 'New Session', keys: ['⌥', '⌘', 'N'] },
        { id: 'shortcuts.open', label: 'Open keyboard shortcuts', keys: ['⌘', '/'] },
        { id: 'sidebar.left', label: 'Toggle left sidebar', keys: ['⌥', '⌘', 'B'] },
        { id: 'session.search', label: 'Search sessions', keys: ['⌥', '⌘', 'K'] },
        { id: 'session.rename', label: 'Rename session', keys: ['⌥', '⌘', 'G'] },
        { id: 'conversation.split', label: 'Split', keys: ['⌘', '\\'] },
      ],
      singleKeys: true,
    })
    const app = sections.find(section => section.title === 'App')
    expect(app?.rows.map(row => row.label)).toEqual(['Search threads', 'Rename thread', 'Split'])
  })

  it('writes the replacement in sentence case', () => {
    expect(CheatSheetModel.glossary('New Session')).toBe('New thread')
    expect(CheatSheetModel.glossary('Session history')).toBe('Thread history')
    expect(CheatSheetModel.glossary('Archive sessions')).toBe('Archive threads')
    expect(CheatSheetModel.glossary('Copy conversation link')).toBe('Copy thread link')
  })
})
