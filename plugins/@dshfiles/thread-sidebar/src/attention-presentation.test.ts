import { describe, expect, it } from 'vitest'
import { attentionDotClass, attentionLabelClass } from './attention-presentation.js'

describe('thread attention presentation', () => {
  it.each([
    ['threadSidebarApprovalNeeded', 'dshx:text-warning/80', 'dshx:bg-warning'],
    ['threadSidebarInputNeeded', 'dshx:text-info/80', 'dshx:bg-info'],
    ['threadSidebarTurnFinished', 'dshx:text-success/80', 'dshx:bg-success'],
  ] as const)('uses semantic colors for %s', (label, textClass, dotClass) => {
    expect(attentionLabelClass(label)).toBe(textClass)
    expect(attentionDotClass({ attentionLabel: label, unread: false, running: false })).toBe(dotClass)
  })

  it('keeps generic unread, running, and idle indicators distinct', () => {
    expect(attentionDotClass({ attentionLabel: undefined, unread: true, running: false })).toBe('dshx:bg-primary')
    expect(attentionDotClass({ attentionLabel: undefined, unread: false, running: true })).toBe('dshx:animate-pulse dshx:bg-info')
    expect(attentionDotClass({ attentionLabel: undefined, unread: false, running: false })).toBe('dshx:bg-muted-foreground/45')
  })

  it('uses the explicit attention label when generic unread is also set', () => {
    expect(attentionDotClass({ attentionLabel: 'threadSidebarTurnFinished', unread: true, running: true })).toBe('dshx:bg-success')
  })
})
