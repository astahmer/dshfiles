// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { InlineReferenceModel, type InlineReferenceContext } from '@dshfiles/chat/inline-references'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  // The native chip: an inline label carrying its title (no activation of its own).
  ReferenceChip: (props: { readonly label: string; readonly title: string }) => createElement('span', { 'data-ref-chip': 'session', title: props.title }, props.label),
}))

import { chatReferencePreviewDismissEvent, chatReferencePreviewEvent, type ChatReference } from './chat-reference.js'
import { ChatReferenceLinks } from './chat-reference-links.js'
import { ChatReferenceTitleStore, type ChatReferenceTitleLoader } from './chat-reference-titles.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const code: InlineReferenceContext = { sessionId: 'session-1', cwd: '/repo', surface: 'code', before: '' }

let root: Root | undefined
let flushes: (() => void)[] = []
let detach: (() => void) | undefined

/** A title store whose batches flush when the test says so, over a loader the test records. */
const titleStore = (titles: Readonly<Record<string, { readonly title: string; readonly root: string } | undefined>>) => {
  const calls: Parameters<ChatReferenceTitleLoader>[0][] = []
  const load: ChatReferenceTitleLoader = input => {
    calls.push(input)
    return Promise.resolve({
      titles: input.references.map(reference => ({ ...reference, title: titles[reference.value]?.title ?? null, root: titles[reference.value]?.root ?? null })),
    })
  }
  const store = new ChatReferenceTitleStore({ load, projectPathForSession: () => '/project', schedule: flush => flushes.push(flush) })
  ChatReferenceLinks.setTitles(store)
  return { store, calls }
}

const flush = async (): Promise<void> => {
  const pending = flushes
  flushes = []
  await act(async () => {
    for (const run of pending) run()
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Render inline code runs the way Chat does: each through the registry's transform. */
const renderCodes = (values: readonly string[], context: InlineReferenceContext = code): void => {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const tree: ReactNode = createElement(
    'p',
    null,
    values.map((value, index) => createElement('code', { key: index }, value)),
  )
  const state = InlineReferenceModel.state([ChatReferenceLinks.reference], { sessionId: context.sessionId, cwd: context.cwd })
  act(() => root?.render(InlineReferenceModel.transform(tree, state)))
}

const chips = (): readonly HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-dshfiles-jj-reference]')]

describe('chat reference links', () => {
  const opened: { readonly reference: ChatReference; readonly targetPath: string }[] = []
  beforeEach(() => {
    opened.length = 0
    detach = ChatReferenceLinks.attach('session-1', { cwd: '/repo', bookmarks: ['main'], onOpen: (reference, targetPath) => opened.push({ reference, targetPath }) })
  })
  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    detach?.()
    flushes = []
    document.body.innerHTML = ''
    document.getSelection()?.removeAllRanges()
  })

  it('links only explicit revision and bookmark tokens while the title is pending', () => {
    titleStore({})
    renderCodes(['jj:feature', 'main', 'kkkkkkkk', 'deadbeefcafe', 'words', 'dead', 'other-branch'])
    expect(chips().map(chip => chip.textContent)).toEqual(['feature', 'main', 'kkkkkkkk', 'deadbeefcafe'])
    expect(chips()[0]?.getAttribute('aria-label')).toBe('Jujutsu bookmark: feature')
    expect(chips()[2]?.getAttribute('aria-label')).toBe('Jujutsu revision: kkkkkkkk')
  })

  it('asks for every visible title in one Host request per render pass', async () => {
    const { calls } = titleStore({ main: { title: 'Base fixture', root: '/repo' } })
    // A transcript with many references, several repeated: the old per-chip path made one request (five jj reads) each.
    const values = Array.from({ length: 40 }, (_unused, index) => (index % 4 === 0 ? 'jj:main' : `jj:branch-${String(index % 10)}`))
    renderCodes(values)
    expect(calls).toHaveLength(0)
    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.paths).toEqual(['/project', '/repo'])
    expect(calls[0]?.references.map(reference => reference.value).sort()).toEqual([...new Set(values.map(value => value.slice('jj:'.length)))].sort())
    // Re-rendering the same references asks for nothing more.
    act(() => root?.unmount())
    renderCodes(values)
    await flush()
    expect(calls).toHaveLength(1)
  })

  it('uses the native reference chip and keeps the full accessible title', async () => {
    const long = 'A very long revision description that keeps going well past the chat label limit'
    titleStore({ main: { title: long, root: '/repo' } })
    renderCodes(['jj:main'])
    await flush()
    const chip = chips()[0]
    expect(chip?.getAttribute('role')).toBe('link')
    expect(chip?.getAttribute('title')).toBe(long)
    expect(chip?.getAttribute('aria-label')).toBe(`Jujutsu bookmark: ${long} (main)`)
    expect(chip?.querySelector('[data-ref-chip="session"]')?.textContent).toMatch(/…$/u)
  })

  it('navigates with the reference on click and on Enter, and ignores other clicks', async () => {
    titleStore({ main: { title: 'Base fixture', root: '/repo' } })
    renderCodes(['jj:main'])
    await flush()
    const chip = chips()[0]
    act(() => void chip?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    act(() => void chip?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    act(() => void chip?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 2 })))
    expect(opened).toEqual([
      { reference: { value: 'main', kind: 'bookmark' }, targetPath: '/repo' },
      { reference: { value: 'main', kind: 'bookmark' }, targetPath: '/repo' },
    ])
  })

  it('opens a reference clicked before its title arrived once it settles, and never one no repository resolves', async () => {
    const { store } = titleStore({ main: { title: 'Base fixture', root: '/repo' } })
    renderCodes(['jj:main', 'jj:foreign-ref'])
    const [main, foreign] = chips()
    act(() => void main?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    act(() => void foreign?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    expect(opened).toEqual([])
    await flush()
    expect(opened.map(open => open.reference.value)).toEqual(['main'])
    // The preview card searched every registered repository and found the foreign one.
    act(() => store.record('session-1', '/repo', { value: 'foreign-ref', kind: 'bookmark' }, { title: 'Foreign only revision', targetPath: '/foreign' }))
    expect(chips()[1]?.textContent).toBe('Foreign only revision')
    act(() => void chips()[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    expect(opened.at(-1)).toEqual({ reference: { value: 'foreign-ref', kind: 'bookmark' }, targetPath: '/foreign' })
  })

  it('previews a hovered reference and takes the request back when the pointer leaves', async () => {
    titleStore({})
    renderCodes(['jj:main'])
    const requests: unknown[] = []
    let dismissed = 0
    const onPreview = (event: Event): void => void requests.push((event as CustomEvent).detail)
    const onDismiss = (): void => void (dismissed += 1)
    window.addEventListener(chatReferencePreviewEvent, onPreview)
    window.addEventListener(chatReferencePreviewDismissEvent, onDismiss)
    const chip = chips()[0]
    act(() => void chip?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
    await act(() => new Promise(resolve => setTimeout(resolve, 220)))
    expect(requests).toEqual([expect.objectContaining({ sessionId: 'session-1', cwd: '/repo', reference: { value: 'main', kind: 'bookmark' } })])
    act(() => void chip?.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })))
    expect(dismissed).toBe(1)
    window.removeEventListener(chatReferencePreviewEvent, onPreview)
    window.removeEventListener(chatReferencePreviewDismissEvent, onDismiss)
  })

  it('leaves another thread, and a thread whose header is gone, alone', () => {
    titleStore({})
    renderCodes(['jj:main'], { ...code, sessionId: 'session-2' })
    expect(chips()).toHaveLength(0)
    act(() => root?.unmount())
    detach?.()
    renderCodes(['jj:main'])
    expect(chips()).toHaveLength(0)
  })
})
