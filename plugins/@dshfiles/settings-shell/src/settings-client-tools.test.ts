import { runClientTool } from '@dshfiles/dshx/client'
import { describe, expect, it } from 'vitest'
import type { OpenSettingsRequest } from './open-settings.js'
import { SettingsClientTools } from './settings-client-tools.js'

const destinations = [
  { id: 'general', label: 'General', group: 'General' },
  { id: 'market', label: 'Plugin Market', group: 'Plugins' },
]

const tools = (tabsOn = true) => {
  const opened: Array<OpenSettingsRequest | 'new-tab'> = []
  const created = SettingsClientTools.create({
    destinations: () => destinations,
    open: request => void opened.push(request),
    openInNewTab: () => {
      if (tabsOn) opened.push('new-tab')
      return tabsOn
    },
  })
  const byName = (name: string) => {
    const tool = created.find(candidate => candidate.name === name)
    if (tool === undefined) throw new Error(`missing ${name}`)
    return tool
  }
  return { opened, byName }
}

const signal = new AbortController().signal

describe('settings client tools', () => {
  it('opens Settings at the Plugin Market by id or by label, through the open-settings path', async () => {
    const { opened, byName } = tools()
    await expect(runClientTool(byName('settings_open'), { section: 'market' }, { signal })).resolves.toEqual({ opened: destinations[1], newTab: false })
    await runClientTool(byName('settings_open'), { section: 'plugin market', query: 'jira' }, { signal })
    expect(opened).toEqual([{ section: 'market' }, { section: 'market', query: 'jira' }])
  })

  it('names the entries it has when the section is unknown, and opens nothing', async () => {
    const { opened, byName } = tools()
    await expect(runClientTool(byName('settings_open'), { section: 'nope' }, { signal })).rejects.toThrow(/market \(Plugin Market\)/u)
    expect(opened).toEqual([])
  })

  it('lists the entries read-only, and only the open tool writes', async () => {
    const { byName } = tools()
    await expect(runClientTool(byName('settings_sections'), {}, { signal })).resolves.toEqual({ sections: destinations })
    expect(byName('settings_sections').readOnly).toBe(true)
    expect(byName('settings_open').readOnly).toBe(false)
    expect(byName('settings_open').description).toMatch(/only when the user asked/u)
  })

  it('opens Settings in its own tab first when asked, and says when tabs are off', async () => {
    const on = tools()
    await expect(runClientTool(on.byName('settings_open'), { section: 'market', newTab: true }, { signal })).resolves.toEqual({
      opened: destinations[1],
      newTab: true,
    })
    expect(on.opened).toEqual(['new-tab', { section: 'market' }])
    const off = tools(false)
    await expect(runClientTool(off.byName('settings_open'), { section: 'market', newTab: true }, { signal })).resolves.toMatchObject({
      newTab: false,
      note: expect.stringMatching(/Tabs are off/u),
    })
    expect(off.opened).toEqual([{ section: 'market' }])
  })
})
