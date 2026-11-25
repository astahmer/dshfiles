import { runClientTool, type BrowserService } from '@dshfiles/dshx/client'
import { describe, expect, it } from 'vitest'
import { BrowserClientTools } from './browser-client-tools.js'

const pane = (input: { readonly available: boolean; readonly accepts: boolean }) => {
  const opened: string[] = []
  const service: BrowserService = {
    available: { get: () => input.available, subscribe: () => () => {} },
    open: url => {
      if (!input.accepts) return false
      opened.push(url)
      return true
    },
  }
  const [tool] = BrowserClientTools.create(service)
  if (tool === undefined) throw new Error('missing browser_open')
  return { opened, tool }
}

const signal = new AbortController().signal

describe('browser pane client tool', () => {
  it('opens an http(s) URL in the pane', async () => {
    const { opened, tool } = pane({ available: true, accepts: true })
    await expect(runClientTool(tool, { url: 'http://localhost:5173' }, { signal })).resolves.toEqual({ opened: 'http://localhost:5173' })
    expect(opened).toEqual(['http://localhost:5173'])
  })

  it('refuses another scheme, a window without a pane, or no thread on screen, each with what to do', async () => {
    await expect(runClientTool(pane({ available: true, accepts: true }).tool, { url: 'file:///etc/passwd' }, { signal })).rejects.toThrow(/not an http/u)
    await expect(runClientTool(pane({ available: false, accepts: true }).tool, { url: 'https://example.com' }, { signal })).rejects.toThrow(/no browser pane/u)
    await expect(runClientTool(pane({ available: true, accepts: false }).tool, { url: 'https://example.com' }, { signal })).rejects.toThrow(/open a thread/u)
  })
})
