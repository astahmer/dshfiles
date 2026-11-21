import { describeClientTool, runClientTool } from '@dshfiles/dshx/client'
import type { HostTarget, WorkbenchTab } from '@dshfiles/workbench/tabs'
import { describe, expect, it } from 'vitest'
import { MainTabsClientTools } from './main-tabs-client-tools.js'
import type { MainTabsService, OpenMainTabOptions } from './tabs-contract.js'

const settingsTab: WorkbenchTab = {
  id: 'panel:dshfiles-settings',
  title: 'Settings',
  active: true,
  pinned: false,
  preview: false,
  available: true,
  status: null,
  kind: 'panel',
  panelId: 'dshfiles-settings',
  target: { kind: 'panel', panelId: 'dshfiles-settings' },
}

const WEB_MCP = 'session-122d56e6-47a7-4103-aab3-6714bc907a68'
const LISTED = [WEB_MCP, 'session-aaaaaa11-0000-4000-8000-000000000001', 'session-aaaaaa12-0000-4000-8000-000000000002']

const fakeTabs = (enabled = true) => {
  const opened: Array<{ readonly target: HostTarget; readonly options: OpenMainTabOptions | undefined }> = []
  const focused: string[] = []
  const service: MainTabsService = {
    tabs: { get: () => (enabled ? [settingsTab] : []), subscribe: () => () => {} },
    open: (target, options) => {
      if (!enabled) return undefined
      opened.push({ target, options })
      return target.kind === 'panel' ? `panel:${target.panelId}` : `thread:${target.sessionId}`
    },
    focus: tabId => {
      focused.push(tabId)
      return tabId === settingsTab.id
    },
    close: () => false,
    pin: () => false,
    reopenClosed: () => false,
  }
  const tools = MainTabsClientTools.create(service, {
    listed: () => LISTED,
    title: sessionId => (sessionId === WEB_MCP ? 'Web MCP [client tools]' : undefined),
  })
  const byName = (name: string) => {
    const tool = tools.find(candidate => candidate.name === name)
    if (tool === undefined) throw new Error(`missing ${name}`)
    return tool
  }
  return { opened, focused, byName }
}

const signal = new AbortController().signal

describe('main-tabs client tools', () => {
  it('opens a panel in a new tab by default and returns its tab id', async () => {
    const tabs = fakeTabs()
    await expect(runClientTool(tabs.byName('tabs_open'), { target: { kind: 'panel', panelId: 'dshfiles-settings' } }, { signal })).resolves.toEqual({
      tabId: 'panel:dshfiles-settings',
    })
    expect(tabs.opened).toEqual([{ target: { kind: 'panel', panelId: 'dshfiles-settings' }, options: { newTab: true } }])
  })

  it('says why nothing opened while tabs are off', async () => {
    const tabs = fakeTabs(false)
    await expect(runClientTool(tabs.byName('tabs_open'), { target: { kind: 'thread', sessionId: WEB_MCP } }, { signal })).rejects.toThrow(
      /Tabs are off[\s\S]*\]\(thread:session-122d56e6/u,
    )
  })

  it('lists the strip read-only and selects a tab by id', async () => {
    const tabs = fakeTabs()
    await expect(runClientTool(tabs.byName('tabs_list'), {}, { signal })).resolves.toEqual({
      tabs: [{ id: 'panel:dshfiles-settings', title: 'Settings', active: true, pinned: false, target: { kind: 'panel', panelId: 'dshfiles-settings' } }],
    })
    await expect(runClientTool(tabs.byName('tabs_focus'), { tabId: 'panel:dshfiles-settings' }, { signal })).resolves.toEqual({
      tabId: 'panel:dshfiles-settings',
    })
    await expect(runClientTool(tabs.byName('tabs_focus'), { tabId: 'gone' }, { signal })).rejects.toThrow(/tabs_list/u)
    expect(tabs.byName('tabs_list').readOnly).toBe(true)
  })

  it('publishes the target union so an Agent sees both kinds', () => {
    const schema = describeClientTool(fakeTabs().byName('tabs_open')).inputSchema
    expect(JSON.stringify(schema)).toMatch(/"thread".*"panel"|"panel".*"thread"/u)
  })

  it('opens a thread named by the short t:<id> memory prints, and returns a link to reopen it', async () => {
    const tabs = fakeTabs()
    await expect(runClientTool(tabs.byName('tabs_open'), { target: { kind: 'thread', sessionId: 't:122d56e6' } }, { signal })).resolves.toEqual({
      tabId: `thread:${WEB_MCP}`,
      sessionId: WEB_MCP,
      link: `[Web MCP client tools](thread:${WEB_MCP})`,
    })
    expect(tabs.opened.at(-1)?.target).toEqual({ kind: 'thread', sessionId: WEB_MCP })
  })

  it('says why a thread reference opened nothing: malformed, ambiguous, or not listed', async () => {
    const open = (sessionId: string) => runClientTool(fakeTabs().byName('tabs_open'), { target: { kind: 'thread', sessionId } }, { signal })
    await expect(open('122')).rejects.toThrow(/not a thread id/u)
    await expect(open('aaaaaa1')).rejects.toThrow(/matches several threads: session-aaaaaa11[\s\S]*Pass the full session id/u)
    await expect(open('t:ffffffff')).rejects.toThrow(/No thread in this window's list matches/u)
  })
})
