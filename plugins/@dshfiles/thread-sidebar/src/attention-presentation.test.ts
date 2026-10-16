import { describe, expect, it } from 'vitest'
import { ThreadAttentionPresentationModel } from './attention-presentation.js'
import { DEFAULT_PREFERENCES } from './organization.js'

const defaultColors = DEFAULT_PREFERENCES.attentionColors

describe('thread attention presentation', () => {
  it.each([
    ['threadSidebarApprovalNeeded', 'dshx:text-warning/80', 'dshx:bg-warning'],
    ['threadSidebarInputNeeded', 'dshx:text-warning/80', 'dshx:bg-warning'],
    ['threadSidebarTurnFinished', 'dshx:text-success/80', 'dshx:bg-success'],
    ['threadSidebarNeedsResume', 'dshx:text-warning/80', 'dshx:bg-warning'],
  ] as const)('uses configured semantic colors for %s', (label, textClass, dotClass) => {
    expect(ThreadAttentionPresentationModel.attentionLabelClass(label, defaultColors)).toBe(textClass)
    expect(ThreadAttentionPresentationModel.attentionDotClass({ attentionLabel: label, attentionColors: defaultColors, unread: false, running: false })).toBe(
      dotClass,
    )
  })

  it('uses independently configured colors for each attention status', () => {
    const attentionColors = { approvalNeeded: 'danger', inputNeeded: 'primary', turnFinished: 'muted' } as const

    expect(ThreadAttentionPresentationModel.attentionLabelClass('threadSidebarApprovalNeeded', attentionColors)).toBe('dshx:text-destructive/80')
    expect(
      ThreadAttentionPresentationModel.attentionDotClass({ attentionLabel: 'threadSidebarApprovalNeeded', attentionColors, unread: false, running: false }),
    ).toBe('dshx:bg-destructive')
    expect(
      ThreadAttentionPresentationModel.attentionDotClass({ attentionLabel: 'threadSidebarInputNeeded', attentionColors, unread: false, running: false }),
    ).toBe('dshx:bg-primary')
    expect(
      ThreadAttentionPresentationModel.attentionDotClass({ attentionLabel: 'threadSidebarTurnFinished', attentionColors, unread: false, running: false }),
    ).toBe('dshx:bg-muted-foreground/45')
  })

  it('uses different default colors for input-needed and working threads', () => {
    expect(
      ThreadAttentionPresentationModel.attentionDotClass({
        attentionLabel: 'threadSidebarInputNeeded',
        attentionColors: defaultColors,
        unread: false,
        running: false,
      }),
    ).toBe('dshx:bg-warning')
    expect(
      ThreadAttentionPresentationModel.attentionDotClass({ attentionLabel: undefined, attentionColors: defaultColors, unread: false, running: true }),
    ).toBe('dshx:animate-pulse dshx:bg-info')
  })

  it('keeps generic unread, running, and idle indicators distinct', () => {
    expect(
      ThreadAttentionPresentationModel.attentionDotClass({ attentionLabel: undefined, attentionColors: defaultColors, unread: true, running: false }),
    ).toBe('dshx:bg-primary')
    expect(
      ThreadAttentionPresentationModel.attentionDotClass({ attentionLabel: undefined, attentionColors: defaultColors, unread: false, running: true }),
    ).toBe('dshx:animate-pulse dshx:bg-info')
    expect(
      ThreadAttentionPresentationModel.attentionDotClass({ attentionLabel: undefined, attentionColors: defaultColors, unread: false, running: false }),
    ).toBe('dshx:bg-muted-foreground/45')
  })

  it('uses the explicit attention color when generic unread is also set', () => {
    expect(
      ThreadAttentionPresentationModel.attentionDotClass({
        attentionLabel: 'threadSidebarTurnFinished',
        attentionColors: defaultColors,
        unread: true,
        running: true,
      }),
    ).toBe('dshx:bg-success')
  })
})
