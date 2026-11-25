import { describe, expect, it } from 'vitest'
import { StageFold, type StageFoldState } from './stage-fold.js'

const open: StageFoldState = { folded: false, userOpened: false }

describe('StageFold.step', () => {
  it('folds an open column when the stage page asks, and opens it again when the page leaves', () => {
    const fold = StageFold.step(open, { wants: true, collapsed: false })
    expect(fold).toEqual({ next: { folded: true, userOpened: false }, toggle: true })
    const held = StageFold.step(fold.next, { wants: true, collapsed: true })
    expect(held).toEqual({ next: fold.next, toggle: false })
    expect(StageFold.step(held.next, { wants: false, collapsed: true })).toEqual({ next: open, toggle: true })
  })

  it('never opens a column the person collapsed', () => {
    const step = StageFold.step(open, { wants: true, collapsed: true })
    expect(step).toEqual({ next: open, toggle: false })
    expect(StageFold.step(step.next, { wants: false, collapsed: true }).toggle).toBe(false)
  })

  it('keeps a column opened by hand open until the page leaves', () => {
    const opened = StageFold.step({ folded: true, userOpened: false }, { wants: true, collapsed: false })
    expect(opened).toEqual({ next: { folded: false, userOpened: true }, toggle: false })
    expect(StageFold.step(opened.next, { wants: true, collapsed: false }).toggle).toBe(false)
    expect(StageFold.step(opened.next, { wants: false, collapsed: false })).toEqual({ next: open, toggle: false })
  })

  it('opens a column a reload left folded once the page is gone', () => {
    // The frame restored its collapse; the stored marker says the stage folded it.
    expect(StageFold.step({ folded: true, userOpened: false }, { wants: false, collapsed: true })).toEqual({ next: open, toggle: true })
  })
})

describe('StageFold.wants', () => {
  const base = { builtIn: true, settingsPanelId: 'dshfiles-settings', solePanelId: undefined }

  it('wants Settings folded only while its page is on stage', () => {
    expect(StageFold.wants({ ...base, folderId: 'settings', activePanelId: 'dshfiles-settings' })).toBe(true)
    expect(StageFold.wants({ ...base, folderId: 'settings', activePanelId: 'plugins' })).toBe(false)
    expect(StageFold.wants({ ...base, folderId: 'threads', activePanelId: 'dshfiles-settings' })).toBe(false)
  })

  it('wants a one-page destination folded while that page is on stage', () => {
    expect(StageFold.wants({ ...base, folderId: 'inbox', activePanelId: 'attention-inbox', solePanelId: 'attention-inbox' })).toBe(true)
    expect(StageFold.wants({ ...base, folderId: 'inbox', activePanelId: null, solePanelId: 'attention-inbox' })).toBe(false)
    expect(StageFold.wants({ ...base, folderId: 'observe', activePanelId: 'dshfiles-usage' })).toBe(false)
    expect(StageFold.wants({ ...base, builtIn: false, folderId: 'mine', activePanelId: 'x', solePanelId: 'x' })).toBe(false)
  })
})
