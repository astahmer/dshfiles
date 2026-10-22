// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chatReferencePreviewDismissEvent,
  chatReferencePreviewEvent,
  chatReferenceTitleRequestEvent,
  chatReferenceTitleResolvedEvent,
} from './chat-reference.js'
import { installChatReferenceLinks } from './chat-reference-links.js'

const referenceChipTemplate =
  '<span aria-hidden="true" data-composer-card data-dshfiles-jj-reference-template hidden><span class="native-session-reference" data-ref-chip="session"><svg class="native-reference-icon"></svg>Session reference</span></span>'

const sessionMarkup = (inner: string, includeTemplate = true): string =>
  `${includeTemplate ? referenceChipTemplate : ''}<div data-conversation-session="session-1">${inner}</div>`

const marked = (): readonly (string | null)[] => [...document.querySelectorAll('code[data-dshfiles-jj-reference-owner]')].map(element => element.textContent)

const chipIn = (element: Element | null | undefined): HTMLElement | null => element?.querySelector<HTMLElement>('[data-dshfiles-jj-reference]') ?? null

const click = (element: Element | null | undefined): void => void element?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))

const install = (onOpen: (reference: { readonly value: string; readonly kind: string }) => void) =>
  installChatReferenceLinks({ sessionId: 'session-1', cwd: '/repo', bookmarks: ['main'], onOpen })

const settlePreview = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 220))

const settleMarks = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 60))

describe('chat reference links', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.getSelection()?.removeAllRanges()
  })

  it('links only explicit revision and bookmark tokens while the title is pending', () => {
    const onOpen = vi.fn()
    document.body.innerHTML =
      sessionMarkup('<code>jj:main</code><code>jj:94526da8</code><code>main</code><code>not a ref</code><code>pnpm</code>') +
      '<div data-conversation-session="session-2"><code>jj:main</code></div>'
    const stop = install(onOpen)

    expect(marked()).toEqual(['main', '94526da8', 'main'])
    const code = document.querySelector('code[data-dshfiles-jj-reference-owner]')
    const link = chipIn(code)
    expect(link?.getAttribute('role')).toBe('link')
    expect(link?.getAttribute('tabindex')).toBe('0')
    expect(link?.className).toBe('native-session-reference')
    expect(link?.querySelector('svg.native-reference-icon')).not.toBeNull()
    expect(link?.getAttribute('data-ref-chip')).toBeNull()
    expect(code?.getAttribute('data-dshfiles-jj-prefixed')).toBe('')
    stop()
  })

  it('upgrades an early reference when the native session-chip template mounts', async () => {
    const onOpen = vi.fn()
    document.body.innerHTML = sessionMarkup('<code>jj:main</code>', false)
    const stop = install(onOpen)
    const code = document.querySelector('code')
    expect(chipIn(code)?.querySelector('svg')).toBeNull()

    document.body.insertAdjacentHTML('afterbegin', referenceChipTemplate)
    await settleMarks()

    const link = chipIn(code)
    expect(link?.className).toBe('native-session-reference')
    expect(link?.querySelector('svg.native-reference-icon')).not.toBeNull()
    stop()
  })

  it('uses the native reference chip and keeps the full accessible title', async () => {
    const onOpen = vi.fn()
    const title = 'a'.repeat(80)
    let request: unknown
    const onRequest = (event: Event): void => {
      if (event instanceof CustomEvent) request = event.detail
    }
    window.addEventListener(chatReferenceTitleRequestEvent, onRequest)
    document.body.innerHTML = sessionMarkup('<code>jj:main</code>')
    const stop = install(onOpen)
    const code = document.querySelector('code')
    const link = chipIn(code)
    if (code === null || link === null) throw new Error('No reference chip')
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

    expect(request).toEqual({ sessionId: 'session-1', cwd: '/repo', reference: { value: 'main', kind: 'bookmark' } })
    window.dispatchEvent(
      new CustomEvent(chatReferenceTitleResolvedEvent, {
        detail: { sessionId: 'session-2', cwd: '/repo', reference: { value: 'main', kind: 'bookmark' }, title: 'Wrong title' },
      }),
    )
    expect(link.textContent).toBe('main')
    window.dispatchEvent(
      new CustomEvent(chatReferenceTitleResolvedEvent, {
        detail: { sessionId: 'session-1', cwd: '/repo', reference: { value: 'main', kind: 'bookmark' }, title, targetPath: '/other-repo' },
      }),
    )

    expect(link.textContent).toBe(`${'a'.repeat(51)}…`)
    expect(link.getAttribute('title')).toBe(title)
    expect(link.getAttribute('aria-label')).toBe(`Jujutsu bookmark: ${title} (main)`)
    expect(link.getAttribute('data-ref-chip')).toBeNull()
    expect(link.querySelector('svg.native-reference-icon')).not.toBeNull()
    click(link)
    expect(onOpen).toHaveBeenCalledWith({ value: 'main', kind: 'bookmark' }, '/other-repo')

    stop()
    expect(code.textContent).toBe('jj:main')
    expect(code.querySelector('[data-dshfiles-jj-reference]')).toBeNull()
    expect(code.getAttribute('title')).toBeNull()
    expect(code.getAttribute('aria-label')).toBeNull()
    window.removeEventListener(chatReferenceTitleRequestEvent, onRequest)
  })

  it('navigates with the reference on click and on Enter, and ignores other clicks', () => {
    const onOpen = vi.fn()
    document.body.innerHTML = sessionMarkup('<code>jj:main</code><code>pnpm</code>')
    const stop = install(onOpen)
    const codes = document.querySelectorAll('code')
    const link = chipIn(codes[0])

    click(link)
    expect(onOpen).not.toHaveBeenCalled()
    window.dispatchEvent(
      new CustomEvent(chatReferenceTitleResolvedEvent, {
        detail: { sessionId: 'session-1', cwd: '/repo', reference: { value: 'main', kind: 'bookmark' }, title: 'main', targetPath: '/other-repo' },
      }),
    )
    expect(onOpen).toHaveBeenCalledWith({ value: 'main', kind: 'bookmark' }, '/other-repo')

    link?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    expect(onOpen).toHaveBeenCalledTimes(2)

    click(codes[1])
    expect(onOpen).toHaveBeenCalledTimes(2)
    stop()
  })

  it('does not navigate when cross-repository lookup reports ambiguity', () => {
    const onOpen = vi.fn()
    document.body.innerHTML = sessionMarkup('<code>jj:main</code>')
    const stop = install(onOpen)
    window.dispatchEvent(
      new CustomEvent(chatReferenceTitleResolvedEvent, {
        detail: { sessionId: 'session-1', cwd: '/repo', reference: { value: 'main', kind: 'bookmark' }, title: 'main', targetPath: null },
      }),
    )

    click(chipIn(document.querySelector('code')))
    expect(onOpen).not.toHaveBeenCalled()
    stop()
  })

  it('previews a hovered reference and takes the request back when the pointer leaves', async () => {
    const onOpen = vi.fn()
    const requests: unknown[] = []
    let dismissals = 0
    const onRequest = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      requests.push(event.detail)
    }
    const onDismiss = (): void => void (dismissals += 1)
    window.addEventListener(chatReferencePreviewEvent, onRequest)
    window.addEventListener(chatReferencePreviewDismissEvent, onDismiss)
    document.body.innerHTML = sessionMarkup('<code>jj:main</code>')
    const stop = install(onOpen)
    const link = chipIn(document.querySelector('code'))

    link?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    await settlePreview()
    expect(requests).toEqual([{ cwd: '/repo', reference: { value: 'main', kind: 'bookmark' }, anchor: { left: 0, top: 0, width: 0, height: 0 } }])
    expect(onOpen).not.toHaveBeenCalled()

    link?.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
    expect(dismissals).toBe(1)

    window.removeEventListener(chatReferencePreviewEvent, onRequest)
    window.removeEventListener(chatReferencePreviewDismissEvent, onDismiss)
    stop()
  })

  it('re-strips a prefix React rewrites and stops linking a token that changed', async () => {
    const onOpen = vi.fn()
    document.body.innerHTML = sessionMarkup('<code>jj:main</code>')
    const stop = install(onOpen)
    const code = document.querySelector('code')
    if (code === null) throw new Error('No code element')
    expect(code.textContent).toBe('main')

    code.textContent = 'jj:main'
    await settleMarks()
    expect(code.textContent).toBe('main')

    code.textContent = 'jj:two words'
    await settleMarks()
    expect(code.textContent).toBe('jj:two words')
    expect(code.getAttribute('role')).toBeNull()
    expect(chipIn(code)).toBeNull()
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
    expect(document.querySelectorAll('[data-dshfiles-jj-reference][role="link"]')).toHaveLength(0)
  })

  it('rescans only the code that changed, not the whole conversation', async () => {
    const onOpen = vi.fn()
    document.body.innerHTML = sessionMarkup('<code>jj:main</code><code>jj:94526da8</code>')
    const stop = install(onOpen)
    const conversation = document.querySelector('[data-conversation-session="session-1"]')
    const changed = document.querySelectorAll('code')[0]
    if (conversation === null || changed === undefined) throw new Error('fixture conversation is missing')

    const scans = vi.spyOn(conversation, 'querySelectorAll')
    changed.textContent = 'ordinary words'
    await settleMarks()

    expect(scans).not.toHaveBeenCalled()
    expect(changed.getAttribute('data-dshfiles-jj-reference-owner')).toBeNull()
    expect(marked()).toEqual(['94526da8'])
    scans.mockRestore()
    stop()
  })
})
