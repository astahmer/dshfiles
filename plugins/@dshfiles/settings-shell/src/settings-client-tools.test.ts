import { runClientTool } from '@dshfiles/dshx/client'
import { describe, expect, it } from 'vitest'
import type { OpenSettingsRequest } from './open-settings.js'
import { SettingsClientTools } from './settings-client-tools.js'

const destinations = [
  { id: 'general', label: 'General', group: 'General' },
  { id: 'market', label: 'Plugin Market', group: 'Plugins' },
]

const tools = () => {
  const opened: OpenSettingsRequest[] = []
  const created = SettingsClientTools.create({ destinations: () => destinations, open: request => opened.push(request) })
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
    await expect(runClientTool(byName('settings_open'), { section: 'market' }, { signal })).resolves.toEqual({ opened: destinations[1] })
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
})
