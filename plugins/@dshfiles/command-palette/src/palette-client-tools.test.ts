import { runClientTool } from '@dshfiles/dshx/client'
import { describe, expect, it } from 'vitest'
import { PaletteClientTools } from './palette-client-tools.js'
import type { PaletteAction, PaletteActionContext } from './palette-contract.js'

const onThread: PaletteActionContext = {
  thread: { id: 's1', title: 'Fix auth', cwd: '/repo', workspaceId: undefined, pinned: false, archived: false },
  workspace: null,
  workspaces: [],
  themePreference: 'system',
}
const nowhere: PaletteActionContext = { ...onThread, thread: null }

const fixture = (context: PaletteActionContext) => {
  const ran: Array<{ readonly id: string; readonly thread: string | null }> = []
  const actions: PaletteAction[] = [
    {
      id: '@dshfiles/settings-shell/open',
      label: 'Open Settings',
      aliases: ['preferences'],
      group: 'command',
      keys: ['Mod+,'],
      run: () => void ran.push({ id: 'settings', thread: null }),
    },
    {
      id: '@dshfiles/thread-sidebar/archive',
      label: () => 'Archive thread',
      group: 'thread',
      heading: () => 'Actions for “Fix auth”',
      isAvailable: current => current.thread !== null,
      run: current => void ran.push({ id: 'archive', thread: current.thread?.id ?? null }),
    },
  ]
  const tools = PaletteClientTools.create({ actions: () => actions, context: () => context })
  const byName = (name: string) => {
    const tool = tools.find(candidate => candidate.name === name)
    if (tool === undefined) throw new Error(`missing ${name}`)
    return tool
  }
  return { ran, byName }
}

const signal = new AbortController().signal

describe('palette client tools', () => {
  it('lists the commands available where the user is, with their labels and keys', async () => {
    await expect(runClientTool(fixture(onThread).byName('palette_commands'), {}, { signal })).resolves.toEqual({
      total: 2,
      thread: { id: 's1', title: 'Fix auth' },
      commands: [
        { id: '@dshfiles/settings-shell/open', label: 'Open Settings', group: 'command', keys: ['Mod+,'] },
        { id: '@dshfiles/thread-sidebar/archive', label: 'Archive thread', group: 'thread', heading: 'Actions for “Fix auth”' },
      ],
    })
    await expect(runClientTool(fixture(nowhere).byName('palette_commands'), { query: 'prefer' }, { signal })).resolves.toMatchObject({
      total: 1,
      commands: [{ id: '@dshfiles/settings-shell/open' }],
    })
  })

  it('runs a command with the thread on screen, only with confirm', async () => {
    const { ran, byName } = fixture(onThread)
    await expect(runClientTool(byName('palette_run'), { id: '@dshfiles/thread-sidebar/archive' }, { signal })).rejects.toThrow(/validation failed/u)
    expect(ran).toEqual([])
    await expect(runClientTool(byName('palette_run'), { id: '@dshfiles/thread-sidebar/archive', confirm: true }, { signal })).resolves.toEqual({
      ran: '@dshfiles/thread-sidebar/archive',
      label: 'Archive thread',
    })
    expect(ran).toEqual([{ id: 'archive', thread: 's1' }])
  })

  it('refuses an unknown command or one not available here, saying what to do', async () => {
    const { ran, byName } = fixture(nowhere)
    await expect(runClientTool(byName('palette_run'), { id: 'nope', confirm: true }, { signal })).rejects.toThrow(/palette_commands/u)
    await expect(runClientTool(byName('palette_run'), { id: '@dshfiles/thread-sidebar/archive', confirm: true }, { signal })).rejects.toThrow(
      /not available where the user is now/u,
    )
    expect(ran).toEqual([])
    expect(byName('palette_commands').readOnly).toBe(true)
    expect(byName('palette_run').description).toMatch(/only when the user asked/u)
  })
})
