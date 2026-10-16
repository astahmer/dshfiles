// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installChatReferenceLinks } from './chat-reference-links.js'

const sessionMarkup = (inner: string): string => `<div data-conversation-session="session-1">${inner}</div>`

const marked = (): readonly (string | null)[] => [...document.querySelectorAll('code[data-dshfiles-jj-reference]')].map(element => element.textContent)

const click = (element: Element | null | undefined): void => void element?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))

const install = (onOpen: (reference: { readonly value: string; readonly kind: string }) => void) =>
  installChatReferenceLinks({ sessionId: 'session-1', bookmarks: ['main'], onOpen })

const settleMarks = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 60))

describe('chat reference links', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.getSelection()?.removeAllRanges()
  })

  it('links only explicit revision and bookmark tokens, showing the bare name', () => {
    const onOpen = vi.fn()
    document.body.innerHTML =
      sessionMarkup('<code>jj:main</code><code>jj:94526da8</code><code>main</code><code>not a ref</code><code>pnpm</code>') +
      '<div data-conversation-session="session-2"><code>jj:main</code></div>'
    const stop = install(onOpen)

    expect(marked()).toEqual(['main', '94526da8', 'main'])
    const link = document.querySelector('code[data-dshfiles-jj-reference]')
    expect(link?.getAttribute('role')).toBe('link')
    expect(link?.getAttribute('tabindex')).toBe('0')
    expect(link?.getAttribute('data-dshfiles-jj-prefixed')).toBe('')
    stop()
  })

  it('navigates with the plain name on click and on Enter, and ignores other clicks', () => {
    const onOpen = vi.fn()
    document.body.innerHTML = sessionMarkup('<code>jj:main</code><code>pnpm</code>')
    const stop = install(onOpen)

    click(document.querySelectorAll('code')[0])
    expect(onOpen).toHaveBeenCalledWith({ value: 'main', kind: 'bookmark' })

    document.querySelectorAll('code')[0]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    expect(onOpen).toHaveBeenCalledTimes(2)

    click(document.querySelectorAll('code')[1])
    expect(onOpen).toHaveBeenCalledTimes(2)
    stop()
  })

  it('re-strips a prefix React rewrites and stops linking a token that changed', async () => {
    const onOpen = vi.fn()
    document.body.innerHTML = sessionMarkup('<code>jj:main</code>')
    const stop = install(onOpen)
    const link = document.querySelector('code')
    if (link === null) throw new Error('No code element')
    expect(link.textContent).toBe('main')

    link.textContent = 'jj:main'
    await settleMarks()
    expect(link.textContent).toBe('main')

    link.textContent = 'jj:two words'
    await settleMarks()
    expect(link.textContent).toBe('jj:two words')
    expect(link.getAttribute('role')).toBeNull()
    expect(marked()).toHaveLength(0)
    stop()
  })

  it('leaves composer references and foreign sessions alone, then clears its marks', () => {
    const onOpen = vi.fn()
    document.body.innerHTML =
      sessionMarkup('<code>jj:main</code>') +
      '<div data-conversation-session="session-1" data-composer-card><code>jj:main</code></div>' +
      '<div data-conversation-session="session-2"><code>jj:main</code></div>'
    const stop = install(onOpen)

    expect(marked()).toEqual(['main'])
    click(document.querySelectorAll('code')[1])
    click(document.querySelectorAll('code')[2])
    expect(onOpen).not.toHaveBeenCalled()

    stop()
    expect(marked()).toHaveLength(0)
    expect(document.querySelectorAll('code[role="link"]')).toHaveLength(0)
  })
})
