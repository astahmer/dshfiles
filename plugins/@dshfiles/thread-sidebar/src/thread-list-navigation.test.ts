// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadListNavigationModel } from './thread-list-navigation.js'
import { EMPTY_THREAD_SELECTION, type ThreadSelectionState } from './thread-selection.js'

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

const dispatchKey = (target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init })
  target.dispatchEvent(event)
  return event
}

const installNavigation = (
  list: HTMLElement,
  initialSelection: ThreadSelectionState = EMPTY_THREAD_SELECTION,
  options: { readonly arrowKeysSwitchThread?: boolean } = {},
) => {
  let selection = initialSelection
  const selections: ThreadSelectionState[] = []
  const opened: string[] = []
  const warmed: string[][] = []
  list.addEventListener('keydown', event =>
    ThreadListNavigationModel.navigate({
      event,
      list,
      selection,
      onSelectionChange: next => {
        selection = next
        selections.push(next)
      },
      onLookahead: sessionIds => warmed.push([...sessionIds]),
      ...(options.arrowKeysSwitchThread === undefined ? {} : { arrowKeysSwitchThread: options.arrowKeysSwitchThread }),
      open: sessionId => opened.push(sessionId),
    }),
  )
  return {
    opened,
    selections,
    warmed,
    selection: () => selection,
  }
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

    const actionEvent = dispatchKey(action, 'ArrowDown')
    const inputEvent = dispatchKey(input, 'ArrowDown')
    const editorEvent = dispatchKey(editor, 'ArrowDown')
    const menuEvent = dispatchKey(menuItem, 'ArrowDown')
    const outsideEvent = dispatchKey(outsideControl, 'ArrowDown')

    expect(callbacks.selections).toEqual([])
    expect(callbacks.warmed).toEqual([])
    expect([actionEvent, inputEvent, editorEvent, menuEvent, outsideEvent].every(event => !event.defaultPrevented)).toBe(true)

    const innerText = document.createElement('span')
    current.button.append(innerText)
    current.button.focus()
    dispatchKey(innerText, 'ArrowDown')
    expect(document.activeElement).toBe(next.button)
    expect(callbacks.selections).toEqual([])

    outsideControl.focus()
    const unfocusedRowEvent = dispatchKey(next.button, 'ArrowDown')
    expect(unfocusedRowEvent.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(outsideControl)
  })

  it('moves focus without opening a thread', () => {
    const list = document.createElement('div')
    const current = threadRow('current')
    const next = threadRow('next')
    list.append(current.article, next.article)
    document.body.append(list)
    const callbacks = installNavigation(list)

    current.button.focus()
    dispatchKey(current.button, 'ArrowDown')

    expect(document.activeElement).toBe(next.button)
    expect(callbacks.warmed).toEqual([['next']])
  })

  it('switches to the focused thread on every arrow when immediate switching is configured', () => {
    const list = document.createElement('div')
    const current = threadRow('current')
    const next = threadRow('next')
    list.append(current.article, next.article)
    document.body.append(list)
    const callbacks = installNavigation(list, EMPTY_THREAD_SELECTION, { arrowKeysSwitchThread: true })

    current.button.focus()
    dispatchKey(current.button, 'ArrowDown')
    dispatchKey(next.button, 'ArrowDown', { shiftKey: true })

    expect(callbacks.opened).toEqual(['next'])
    expect(document.activeElement).toBe(next.button)
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

    dispatchKey(second.button, 'ArrowDown', { repeat: true })
    dispatchKey(third.button, 'ArrowDown', { repeat: true })
    const boundary = dispatchKey(fourth.button, 'ArrowDown', { repeat: true })
    dispatchKey(fourth.button, 'ArrowUp', { repeat: true })
    dispatchKey(third.button, 'ArrowUp', { repeat: true })
    dispatchKey(second.button, 'ArrowUp', { repeat: true })

    expect(boundary.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first.button)
    expect(callbacks.warmed).toEqual([['c', 'd'], ['d'], ['c', 'b', 'a'], ['b', 'a'], ['a']])
  })

  it('extends a Shift range from the focused row and clears it on a plain move', () => {
    const list = document.createElement('div')
    const rows = ['a', 'b', 'c', 'd'].map(threadRow)
    list.append(...rows.map(row => row.article))
    document.body.append(list)
    const callbacks = installNavigation(list)
    const b = rows[1]
    const c = rows[2]
    if (b === undefined || c === undefined) throw new Error('Expected two rows')
    b.button.focus()

    const extend = dispatchKey(b.button, 'ArrowDown', { shiftKey: true })
    dispatchKey(c.button, 'ArrowDown', { shiftKey: true })

    expect(extend.defaultPrevented).toBe(true)
    expect(callbacks.selection()).toEqual({ sessionIds: ['b', 'c', 'd'], anchorId: 'b' })

    dispatchKey(rows[3]?.button ?? b.button, 'ArrowUp')
    expect(callbacks.selection()).toEqual(EMPTY_THREAD_SELECTION)
  })

  it('selects every visible row with the primary modifier and clears with Escape', () => {
    const list = document.createElement('div')
    const rows = ['a', 'b', 'c'].map(threadRow)
    list.append(...rows.map(row => row.article))
    document.body.append(list)
    const callbacks = installNavigation(list)
    const b = rows[1]
    if (b === undefined) throw new Error('Expected a row')
    b.button.focus()

    const selectAll = dispatchKey(b.button, 'a', { metaKey: true })
    expect(selectAll.defaultPrevented).toBe(true)
    expect(callbacks.selection()).toEqual({ sessionIds: ['a', 'b', 'c'], anchorId: 'a' })

    const clear = dispatchKey(b.button, 'Escape')
    expect(clear.defaultPrevented).toBe(true)
    expect(callbacks.selection()).toEqual(EMPTY_THREAD_SELECTION)
  })

  it('expands and collapses child rows with Right and Left', () => {
    const list = document.createElement('div')
    document.body.append(list)
    const parent = threadRow('parent')
    const child = mainButton('child')
    const childList = document.createElement('div')
    childList.append(child)
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.dataset.threadChildrenToggle = ''
    toggle.setAttribute('aria-expanded', 'false')
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true'
      toggle.setAttribute('aria-expanded', String(!expanded))
      if (expanded) childList.remove()
      else parent.article.append(childList)
    })
    parent.article.append(toggle)
    list.append(parent.article)
    const callbacks = installNavigation(list)
    parent.button.focus()

    dispatchKey(parent.button, 'ArrowRight')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(parent.button)

    dispatchKey(parent.button, 'ArrowRight')
    expect(document.activeElement).toBe(child)

    dispatchKey(child, 'ArrowLeft')
    expect(document.activeElement).toBe(parent.button)

    dispatchKey(parent.button, 'ArrowLeft')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(callbacks.selections).toEqual([])
  })

  it('collapses and expands a section from its header', () => {
    const list = document.createElement('div')
    document.body.append(list)
    const section = document.createElement('section')
    const header = document.createElement('button')
    header.type = 'button'
    header.dataset.threadSectionHeader = ''
    header.setAttribute('aria-expanded', 'true')
    header.addEventListener('click', () => {
      header.setAttribute('aria-expanded', String(header.getAttribute('aria-expanded') !== 'true'))
    })
    const row = threadRow('row')
    section.append(header, row.article)
    list.append(section)
    installNavigation(list)

    header.focus()
    dispatchKey(header, 'ArrowLeft')
    expect(header.getAttribute('aria-expanded')).toBe('false')

    dispatchKey(header, 'ArrowRight')
    expect(header.getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses an open parent from its row and then moves focus to the section header', () => {
    const list = document.createElement('div')
    document.body.append(list)
    const section = document.createElement('section')
    const header = document.createElement('button')
    header.type = 'button'
    header.dataset.threadSectionHeader = ''
    header.setAttribute('aria-expanded', 'true')
    header.addEventListener('click', () => {
      header.setAttribute('aria-expanded', String(header.getAttribute('aria-expanded') !== 'true'))
    })
    const parent = threadRow('parent')
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.dataset.threadChildrenToggle = ''
    toggle.setAttribute('aria-expanded', 'true')
    toggle.addEventListener('click', () => toggle.setAttribute('aria-expanded', 'false'))
    parent.article.append(toggle)
    section.append(header, parent.article)
    list.append(section)
    installNavigation(list)

    parent.button.focus()
    dispatchKey(parent.button, 'ArrowLeft')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    dispatchKey(parent.button, 'ArrowLeft')
    expect(document.activeElement).toBe(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')

    dispatchKey(header, 'ArrowLeft')
    expect(header.getAttribute('aria-expanded')).toBe('false')
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
