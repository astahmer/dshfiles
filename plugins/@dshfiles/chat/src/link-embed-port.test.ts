import { describe, expect, it, vi } from 'vitest'
import { createLinkEmbedPort, type LinkEmbedCheck } from './link-embed-port.ts'

const check = (input: Partial<LinkEmbedCheck> = {}): LinkEmbedCheck => ({
  url: 'https://github.com/',
  reachable: true,
  status: 200,
  framing: 'allowed',
  verdict: 'open',
  detail: null,
  ...input,
})

const portFor = (answers: (url: string) => Promise<LinkEmbedCheck | undefined>) => {
  const toasts: { readonly title: string; readonly action?: { readonly run: () => void } }[] = []
  const tabs: string[] = []
  const port = createLinkEmbedPort({
    probe: answers,
    toast: input => {
      toasts.push({ title: input.title, action: input.action })
    },
    openInNewTab: url => {
      tabs.push(url)
    },
  })
  return { port, toasts, tabs }
}

describe('LinkEmbedPort', () => {
  it('answers refused only after the Host checked the address', async () => {
    const { port } = portFor(async () => check({ framing: 'denied', verdict: 'refused' }))
    expect(port.refused('https://github.com/')).toBe(false)
    await port.check('https://github.com/')
    expect(port.refused('https://github.com/')).toBe(true)
    expect(port.refused('https://example.com/')).toBe(false)
  })

  it('says why a pane stayed blank, and its action opens a browser tab', async () => {
    const { port, toasts, tabs } = portFor(async () => check({ framing: 'denied', verdict: 'refused', detail: 'X-Frame-Options: deny' }))
    await port.check('https://github.com/')
    port.sayIfRefused('https://github.com/')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(toasts.map(toast => toast.title)).toEqual(['github.com refuses to be embedded'])
    toasts[0]?.action?.run()
    expect(tabs).toEqual(['https://github.com/'])
  })

  it('stays quiet for a page the pane can show, and when the Host cannot answer', async () => {
    const open = portFor(async () => check())
    open.port.sayIfRefused('https://example.com/')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(open.toasts).toEqual([])
    expect(open.tabs).toEqual([])

    const missing = portFor(async () => {
      throw new Error('preview is not installed')
    })
    expect(await missing.port.check('https://example.com/')).toBeUndefined()
    expect(missing.toasts).toEqual([])
  })

  it('asks the Host once for the same address', async () => {
    const probe = vi.fn(async () => check())
    const { port } = portFor(probe)
    port.warm('https://example.com/')
    await port.check('https://example.com/')
    expect(probe).toHaveBeenCalledTimes(1)
  })
})
