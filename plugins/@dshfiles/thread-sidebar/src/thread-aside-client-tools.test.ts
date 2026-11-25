import { runClientTool } from '@dshfiles/dshx/client'
import { describe, expect, it } from 'vitest'
import { ThreadAsideClientTools } from './thread-aside-client-tools.js'

const WEB_MCP = 'session-122d56e6-47a7-4103-aab3-6714bc907a68'
const CURRENT = 'session-0c72d8a1-75d0-48b0-9504-12d7bf4c9e4c'

const fixture = (onScreen: string | undefined) => {
  const opened: string[] = []
  const [tool] = ThreadAsideClientTools.create({
    listed: () => [WEB_MCP, CURRENT],
    title: sessionId => (sessionId === WEB_MCP ? 'Web MCP' : undefined),
    onScreen: () => onScreen,
    openAside: sessionId => void opened.push(sessionId),
  })
  if (tool === undefined) throw new Error('missing thread_open_aside')
  return { opened, tool }
}

const signal = new AbortController().signal

describe('thread aside client tool', () => {
  it('opens a thread named by its short memory id beside the thread on screen, and returns its link', async () => {
    const { opened, tool } = fixture(CURRENT)
    await expect(runClientTool(tool, { sessionId: 't:122d56e6' }, { signal })).resolves.toEqual({
      opened: WEB_MCP,
      beside: CURRENT,
      link: `[Web MCP](thread:${WEB_MCP})`,
    })
    expect(opened).toEqual([WEB_MCP])
  })

  it('refuses without a thread on screen, for the thread on screen itself, or for an unknown id, saying what to do', async () => {
    await expect(runClientTool(fixture(undefined).tool, { sessionId: WEB_MCP }, { signal })).rejects.toThrow(/Use tabs_open instead/u)
    await expect(runClientTool(fixture(WEB_MCP).tool, { sessionId: WEB_MCP }, { signal })).rejects.toThrow(/already the thread on screen/u)
    await expect(runClientTool(fixture(CURRENT).tool, { sessionId: 't:ffffffff' }, { signal })).rejects.toThrow(/No thread in this window's list/u)
    expect(fixture(CURRENT).tool.description).toMatch(/only when the user asked/u)
  })
})
