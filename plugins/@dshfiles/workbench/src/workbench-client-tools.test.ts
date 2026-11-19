import { runClientTool } from '@dshfiles/dshx/client'
import { describe, expect, it } from 'vitest'
import type { WorkbenchPanelDefinition } from './registry.js'
import { WorkbenchClientTools, type ClientToolRegion } from './workbench-client-tools.js'

const component = () => null

const panels: readonly WorkbenchPanelDefinition[] = [
  { id: 'dshfiles-editor.files', title: 'Files', component },
  { id: 'dshfiles-traces', title: 'Traces', discoveryTitle: 'Traces explorer', component },
  { id: 'thread:s1', title: 'Fix auth', component, hiddenFromAdd: true },
]

const fixture = () => {
  const opened: Array<{ readonly panelId: string; readonly region: ClientToolRegion | undefined }> = []
  const tools = WorkbenchClientTools.create({ panels: () => panels, open: (panelId, region) => void opened.push({ panelId, region }) })
  const byName = (name: string) => {
    const tool = tools.find(candidate => candidate.name === name)
    if (tool === undefined) throw new Error(`missing ${name}`)
    return tool
  }
  return { opened, byName }
}

const signal = new AbortController().signal

describe('workbench client tools', () => {
  it('lists the panels a user can add, never runtime occurrences, and filters them', async () => {
    const { byName } = fixture()
    await expect(runClientTool(byName('workbench_panels'), {}, { signal })).resolves.toEqual({
      panels: [
        { id: 'dshfiles-editor.files', title: 'Files', threadPanel: false },
        { id: 'dshfiles-traces', title: 'Traces explorer', threadPanel: false },
      ],
    })
    await expect(runClientTool(byName('workbench_panels'), { query: 'trace' }, { signal })).resolves.toEqual({
      panels: [{ id: 'dshfiles-traces', title: 'Traces explorer', threadPanel: false }],
    })
  })

  it('opens a panel in its usual place or the named region, and refuses an unknown one', async () => {
    const { opened, byName } = fixture()
    await runClientTool(byName('workbench_open_panel'), { panelId: 'dshfiles-traces' }, { signal })
    await expect(runClientTool(byName('workbench_open_panel'), { panelId: 'dshfiles-editor.files', region: 'bottom' }, { signal })).resolves.toEqual({
      opened: 'dshfiles-editor.files',
      title: 'Files',
      region: 'bottom',
    })
    await expect(runClientTool(byName('workbench_open_panel'), { panelId: 'thread:s1' }, { signal })).rejects.toThrow(/workbench_panels/u)
    await expect(runClientTool(byName('workbench_open_panel'), { panelId: 'x', region: 'top' }, { signal })).rejects.toThrow(/validation failed/u)
    expect(opened).toEqual([
      { panelId: 'dshfiles-traces', region: undefined },
      { panelId: 'dshfiles-editor.files', region: 'bottom' },
    ])
  })
})
