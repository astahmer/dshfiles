import { runClientTool } from '@dshfiles/dshx/client'
import { describe, expect, it } from 'vitest'
import { SidepanelClientTools, type SidepanelPage } from './sidepanel-client-tools.js'

const pages: readonly SidepanelPage[] = [
  { kind: 'changes', title: 'Changes', description: 'What this thread changed.' },
  { kind: 'changes', title: 'Changes (turn)', description: undefined },
  { kind: 'terminal', title: 'Terminal', description: undefined },
]

const fixture = (onScreen: string | undefined) => {
  const opened: string[] = []
  const tools = SidepanelClientTools.create({ pages: () => pages, onScreen: () => onScreen, open: kind => void opened.push(kind) })
  const byName = (name: string) => {
    const tool = tools.find(candidate => candidate.name === name)
    if (tool === undefined) throw new Error(`missing ${name}`)
    return tool
  }
  return { opened, byName }
}

const signal = new AbortController().signal

describe('side panel client tools', () => {
  it('lists each guide page once, the first registration of a kind, with the thread on screen', async () => {
    await expect(runClientTool(fixture('s1').byName('sidepanel_tabs'), {}, { signal })).resolves.toEqual({
      thread: 's1',
      pages: [
        { kind: 'changes', title: 'Changes', description: 'What this thread changed.' },
        { kind: 'terminal', title: 'Terminal' },
      ],
    })
  })

  it('opens a guide page beside the thread, and refuses an unknown kind or no thread on screen', async () => {
    const { opened, byName } = fixture('s1')
    await expect(runClientTool(byName('sidepanel_open'), { kind: 'terminal' }, { signal })).resolves.toEqual({ opened: 'terminal', title: 'Terminal' })
    expect(opened).toEqual(['terminal'])
    await expect(runClientTool(byName('sidepanel_open'), { kind: 'browser' }, { signal })).rejects.toThrow(/sidepanel_tabs/u)
    await expect(runClientTool(fixture(undefined).byName('sidepanel_open'), { kind: 'terminal' }, { signal })).rejects.toThrow(/No thread is on screen/u)
    expect(byName('sidepanel_open').description).toMatch(/only when the user asked/u)
  })
})
