// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { HeldGroupsModel } from './held-groups.js'
import { ThreadListNavigationModel } from './thread-list-navigation.js'
import { EMPTY_THREAD_SELECTION } from './thread-selection.js'

const idOf = (thread: { readonly id: string }): string => thread.id
const group = (key: string, ids: readonly string[], label = key) => ({ key, label, threads: ids.map(id => ({ id, fresh: `${id}-now` })) })

describe('HeldGroupsModel', () => {
  it('keeps every row in the group and place it had, with fresh row data, and counts what waits', () => {
    const held = HeldGroupsModel.capture([group('working', ['a', 'b']), group('ready', ['c'])], idOf)
    // a finished and moved to Ready; d is new.
    const live = [group('working', ['b']), group('ready', ['a', 'c', 'd'])]
    const shown = HeldGroupsModel.apply(live, held, idOf)
    expect(shown.map(entry => [entry.key, entry.threads.map(thread => thread.id)])).toEqual([
      ['working', ['a', 'b']],
      ['ready', ['c']],
    ])
    expect(shown[0]?.threads[0]).toEqual({ id: 'a', fresh: 'a-now' })
    expect(HeldGroupsModel.pending(live, held, idOf)).toBe(2)
    expect(HeldGroupsModel.apply(live, null, idOf)).toBe(live)
    expect(HeldGroupsModel.pending(live, null, idOf)).toBe(0)
  })

  it('drops rows that left the list and reports nothing when the order is unchanged', () => {
    const held = HeldGroupsModel.capture([group('ready', ['a', 'b', 'c'])], idOf)
    const live = [group('ready', ['a', 'c'])]
    expect(HeldGroupsModel.apply(live, held, idOf)[0]?.threads.map(idOf)).toEqual(['a', 'c'])
    expect(HeldGroupsModel.pending(live, held, idOf)).toBe(0)
  })
})

describe('ThreadListNavigationModel.move', () => {
  const list = (ids: readonly string[], current?: string): HTMLElement => {
    const root = document.createElement('div')
    for (const id of ids) {
      const article = document.createElement('article')
      article.dataset.threadId = id
      const button = document.createElement('button')
      button.dataset.threadMainAction = ''
      button.dataset.threadId = id
      if (id === current) button.setAttribute('aria-current', 'page')
      article.appendChild(button)
      root.appendChild(article)
    }
    document.body.replaceChildren(root)
    return root
  }
  const focusedId = (): string | undefined => (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.threadId : undefined)

  it('starts on the open thread, then steps like the arrows, and extends a selection with Shift', () => {
    const root = list(['a', 'b', 'c'], 'b')
    const selections: string[][] = []
    const move = (direction: 1 | -1, extend = false) =>
      ThreadListNavigationModel.move({
        list: root,
        direction,
        extend,
        selection: EMPTY_THREAD_SELECTION,
        onSelectionChange: selection => selections.push([...selection.sessionIds]),
        onLookahead: () => {},
      })
    expect(move(1)).toBe(true)
    expect(focusedId()).toBe('b')
    move(1)
    expect(focusedId()).toBe('c')
    move(1)
    expect(focusedId()).toBe('c')
    move(-1, true)
    expect(focusedId()).toBe('b')
    expect(selections.at(-1)).toEqual(['b', 'c'])
    expect(ThreadListNavigationModel.focusedRowId(root)).toBe('b')
  })
})
