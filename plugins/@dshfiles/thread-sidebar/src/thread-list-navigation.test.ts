// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadListNavigationModel } from './thread-list-navigation.js'

const mainButton = (sessionId: string): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.threadId = sessionId
  button.dataset.threadMainAction = ''
  button.textContent = sessionId
  return button
}

const threadRow = (sessionId: string) => {
  const article = document.createElement('article')
  article.dataset.threadId = sessionId
  const button = mainButton(sessionId)
  article.append(button)
  return { article, button }
}

const dispatchArrow = (target: HTMLElement, key: string, repeat = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, repeat })
  target.dispatchEvent(event)
  return event
}

const installNavigation = (list: HTMLElement, onOpen: (sessionId: string) => void = () => undefined) => {
  const opened: string[] = []
  const warmed: string[][] = []
  list.addEventListener('keydown', event =>
    ThreadListNavigationModel.navigate({
      event,
      list,
      open: sessionId => {
        opened.push(sessionId)
        onOpen(sessionId)
      },
      onLookahead: sessionIds => warmed.push([...sessionIds]),
    }),
  )
  return { opened, warmed }
}

afterEach(() => document.body.replaceChildren())

describe('thread list keyboard navigation', () => {
  it('uses rendered DOM order and ignores collapsed or hidden rows', () => {
    const list = document.createElement('div')
    const first = threadRow('first')
    const parent = threadRow('parent')
    const childList = document.createElement('ul')
    const childItem = document.createElement('li')
    const child = mainButton('child')
    childItem.append(child)
    childList.append(childItem)
    parent.article.append(childList)
    const collapsed = document.createElement('section')
    collapsed.hidden = true
    collapsed.append(threadRow('collapsed').article)
    const hiddenByStyle = document.createElement('section')
    hiddenByStyle.style.display = 'none'
    hiddenByStyle.append(threadRow('hidden').article)
    const last = threadRow('last')
    list.append(first.article, parent.article, collapsed, hiddenByStyle, last.article)
    document.body.append(list)

    expect(ThreadListNavigationModel.visibleRows(list).map(row => row.id)).toEqual(['first', 'parent', 'child', 'last'])

    childList.hidden = true
    expect(ThreadListNavigationModel.visibleRows(list).map(row => row.id)).toEqual(['first', 'parent', 'last'])
  })

  it('handles only main row buttons, not editable controls, menus, row actions, or other sidebar controls', () => {
    const list = document.createElement('div')
    const current = threadRow('current')
    const next = threadRow('next')
    const action = document.createElement('button')
    action.dataset.threadRowAction = ''
    const input = document.createElement('input')
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    const menuItem = document.createElement('button')
    menuItem.setAttribute('role', 'menuitem')
    menu.append(menuItem)
    current.article.append(action, input, editor, menu)
    list.append(current.article, next.article)
    const outsideControl = document.createElement('button')
    document.body.append(list, outsideControl)
    const callbacks = installNavigation(list)

    const actionEvent = dispatchArrow(action, 'ArrowDown')
    const inputEvent = dispatchArrow(input, 'ArrowDown')
    const editorEvent = dispatchArrow(editor, 'ArrowDown')
    const menuEvent = dispatchArrow(menuItem, 'ArrowDown')
    const outsideEvent = dispatchArrow(outsideControl, 'ArrowDown')

    expect(callbacks.opened).toEqual([])
    expect(callbacks.warmed).toEqual([])
    expect([actionEvent, inputEvent, editorEvent, menuEvent, outsideEvent].every(event => !event.defaultPrevented)).toBe(true)

    const innerText = document.createElement('span')
    current.button.append(innerText)
    current.button.focus()
    dispatchArrow(innerText, 'ArrowDown')
    expect(callbacks.opened).toEqual(['next'])
    expect(document.activeElement).toBe(next.button)

    outsideControl.focus()
    const unfocusedRowEvent = dispatchArrow(next.button, 'ArrowDown')
    expect(unfocusedRowEvent.defaultPrevented).toBe(false)
    expect(callbacks.opened).toEqual(['next'])
  })

  it('restores row focus after opening moves focus elsewhere', () => {
    const list = document.createElement('div')
    const current = threadRow('current')
    const next = threadRow('next')
    const outsideControl = document.createElement('button')
    list.append(current.article, next.article)
    document.body.append(list, outsideControl)
    const frames: FrameRequestCallback[] = []
    const previousRequestAnimationFrame = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame')
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      },
    })

    try {
      const callbacks = installNavigation(list, () => outsideControl.focus())
      current.button.focus()
      dispatchArrow(current.button, 'ArrowDown')
      expect(callbacks.opened).toEqual(['next'])
      expect(document.activeElement).toBe(outsideControl)
      const restoreFocus = frames.shift()
      if (restoreFocus === undefined) throw new Error('Expected a focus-restoration frame')
      restoreFocus(0)
      expect(document.activeElement).toBe(next.button)
    } finally {
      if (previousRequestAnimationFrame === undefined) Reflect.deleteProperty(window, 'requestAnimationFrame')
      if (previousRequestAnimationFrame !== undefined) Object.defineProperty(window, 'requestAnimationFrame', previousRequestAnimationFrame)
    }
  })

  it('accepts every repeated ArrowDown and ArrowUp target without wrapping', () => {
    const list = document.createElement('div')
    const rows = ['a', 'b', 'c', 'd'].map(threadRow)
    list.append(...rows.map(row => row.article))
    document.body.append(list)
    const callbacks = installNavigation(list)
    const first = rows[0]
    const second = rows[1]
    const third = rows[2]
    const fourth = rows[3]
    if (first === undefined || second === undefined || third === undefined || fourth === undefined) throw new Error('Expected four thread rows')
    second.button.focus()

    dispatchArrow(second.button, 'ArrowDown', true)
    dispatchArrow(third.button, 'ArrowDown', true)
    const boundary = dispatchArrow(fourth.button, 'ArrowDown', true)
    dispatchArrow(fourth.button, 'ArrowUp', true)
    dispatchArrow(third.button, 'ArrowUp', true)
    dispatchArrow(second.button, 'ArrowUp', true)

    expect(boundary.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first.button)
    expect(callbacks.opened).toEqual(['c', 'd', 'c', 'b', 'a'])
    expect(callbacks.warmed).toEqual([['c', 'd'], ['d'], ['c', 'b', 'a'], ['b', 'a'], ['a']])
  })

  it('bounds lookahead to target plus two adjacent visible rows in movement direction', () => {
    const list = document.createElement('div')
    list.append(...['a', 'b', 'c', 'd', 'e'].map(sessionId => threadRow(sessionId).button))
    const rows = ThreadListNavigationModel.visibleRows(list)

    expect(ThreadListNavigationModel.lookahead({ rows, index: 1, direction: 1 })).toEqual(['b', 'c', 'd'])
    expect(ThreadListNavigationModel.lookahead({ rows, index: 3, direction: -1 })).toEqual(['d', 'c', 'b'])
  })

  it('aborts and releases replaced references before late ready results settle', async () => {
    let resolveStaleReady: (() => void) | undefined
    const staleReady = new Promise<void>(resolve => {
      resolveStaleReady = resolve
    })
    const acquisitions: { readonly id: string; readonly signal: AbortSignal; readonly release: ReturnType<typeof vi.fn> }[] = []
    const retain = (id: string, signal: AbortSignal) => {
      const release = vi.fn()
      acquisitions.push({ id, signal, release })
      return { ready: id === 'stale' ? staleReady : Promise.resolve(), release }
    }

    const releaseStale = ThreadListNavigationModel.retainLookahead({ sessionIds: ['stale', 'stale', 'neighbor-1', 'neighbor-2', 'overflow'], retain })
    expect(acquisitions.map(acquisition => acquisition.id)).toEqual(['stale', 'neighbor-1', 'neighbor-2'])
    const staleAcquisitions = acquisitions.slice()
    releaseStale()
    releaseStale()

    const releaseCurrent = ThreadListNavigationModel.retainLookahead({ sessionIds: ['current'], retain })
    resolveStaleReady?.()
    await staleReady

    expect(staleAcquisitions.every(acquisition => acquisition.signal.aborted)).toBe(true)
    expect(staleAcquisitions.every(acquisition => acquisition.release.mock.calls.length === 1)).toBe(true)
    expect(acquisitions[3]?.signal.aborted).toBe(false)
    expect(acquisitions[3]?.release).not.toHaveBeenCalled()

    releaseCurrent()
    expect(acquisitions[3]?.signal.aborted).toBe(true)
    expect(acquisitions[3]?.release).toHaveBeenCalledOnce()
  })
})
