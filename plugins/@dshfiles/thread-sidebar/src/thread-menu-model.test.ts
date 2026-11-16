import { describe, expect, it } from 'vitest'
import { THREAD_MENU_COPY, THREAD_MENU_MORE, THREAD_MENU_OPEN_IN, THREAD_MENU_TOP, ThreadMenuModel, type ThreadMenuEntryId } from './thread-menu-model.js'

const EVERY_ENTRY: ReadonlySet<ThreadMenuEntryId> = new Set<ThreadMenuEntryId>([
  ...THREAD_MENU_TOP,
  ...THREAD_MENU_OPEN_IN,
  ...THREAD_MENU_COPY,
  ...THREAD_MENU_MORE.flat(),
])
/** What the thread list's row menu can run: everything but the open thread's own tools. */
const ROW: ReadonlySet<ThreadMenuEntryId> = new Set(
  [...EVERY_ENTRY].filter(id => !['find', 'turns', 'thread-views', 'native-open-in', 'copy-markdown'].includes(id)),
)

describe('the thread menu layout', () => {
  it('keeps the top level short: the lifecycle verbs, three common ones and one row per submenu', () => {
    // The row menu was 18 flat rows. Nothing is removed: the rest sits under Open in, Copy and More.
    const menu = ThreadMenuModel.layout({ offered: ROW, archived: false, phone: false })
    expect(menu.top).toEqual(['pin', 'done', 'snooze', 'rename', 'side-panel', 'copy-link'])
    expect(ThreadMenuModel.topLevelCount(menu)).toBe(9)
    const everywhere = [...menu.top, ...menu.openIn, ...menu.copy, ...menu.more.flat()]
    expect([...ROW].filter(id => id !== 'restore' && !everywhere.includes(id))).toEqual([])
  })

  it('orders the row menu and the header menu the same way', () => {
    const header = new Set<ThreadMenuEntryId>([
      'find',
      'pin',
      'done',
      'snooze',
      'copy-link',
      'continue-in',
      'copy-id',
      'turns',
      'mute',
      'referenced-by',
      'archive',
    ])
    const headerMenu = ThreadMenuModel.layout({ offered: header, archived: false, phone: false })
    const rowMenu = ThreadMenuModel.layout({ offered: ROW, archived: false, phone: false })
    const shared = (ids: readonly ThreadMenuEntryId[]): ThreadMenuEntryId[] => ids.filter(id => header.has(id) && ROW.has(id))
    expect(shared(headerMenu.top)).toEqual(shared(rowMenu.top))
    expect(shared(headerMenu.more.flat())).toEqual(shared(rowMenu.more.flat()))
    // Archive closes the thread for good, so it is the last row of More in both.
    expect(headerMenu.more.at(-1)).toEqual(['archive'])
    expect(rowMenu.more.at(-1)).toEqual(['archive'])
  })

  it('leaves out what needs a side panel on the phone shell', () => {
    const menu = ThreadMenuModel.layout({ offered: ROW, archived: false, phone: true })
    expect(menu.top).not.toContain('side-panel')
    expect(menu.openIn).not.toContain('side-panel-views')
    expect(ThreadMenuModel.topLevelCount(menu)).toBe(8)
  })

  it('shows no single-key hint on a touch device', () => {
    expect(ThreadMenuModel.keyHint('P', false)).toBe('P')
    expect(ThreadMenuModel.keyHint('P', true)).toBeUndefined()
    expect(ThreadMenuModel.keyHint('Mod+F', true)).toBeUndefined()
  })

  it('offers an archived thread Restore instead of the lifecycle verbs that no longer apply', () => {
    const menu = ThreadMenuModel.layout({ offered: ROW, archived: true, phone: false })
    expect(menu.top).toEqual(['restore', 'rename', 'copy-link'])
    expect(menu.more.flat()).not.toContain('archive')
    expect(ThreadMenuModel.layout({ offered: ROW, archived: false, phone: false }).top).not.toContain('restore')
  })
})
