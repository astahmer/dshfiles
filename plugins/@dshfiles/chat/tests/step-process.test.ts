import { describe, expect, it } from 'vitest'
import { groupOwnsHeader, processTitle } from '../src/native/chat/step-process.ts'
import { en } from '../src/native/locale.ts'

type Translate = Parameters<typeof processTitle>[1]

// SAFETY: the title reads plain keys of the English catalog with at most one {name} parameter each.
const t = ((key: keyof typeof en, params?: Record<string, string>) =>
  en[key].replaceAll(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? '')) as unknown as Translate

const summary = (...kinds: Parameters<typeof processTitle>[0]['counts'][number]['kind'][]) => ({
  counts: kinds.map((kind, index) => ({ kind, count: kinds.length - index })),
  running: undefined,
  runningDetail: '',
})

describe('groupOwnsHeader', () => {
  const finished = { turnOpen: false, deferCollapse: false }

  it('adds no second fold inside a finished Turn that its "Worked for" row already folds', () => {
    expect(groupOwnsHeader({ stepGrouping: 'history', ...finished, turnFolds: true })).toBe(false)
    expect(groupOwnsHeader({ stepGrouping: 'collapsed', ...finished, turnFolds: true })).toBe(false)
  })

  it('keeps the header where nothing else folds the rows', () => {
    // A failed or stopped Turn stays open, so its groups are its only folds.
    expect(groupOwnsHeader({ stepGrouping: 'history', ...finished, turnFolds: false })).toBe(true)
    // Summary groups a running Turn's steps.
    expect(groupOwnsHeader({ stepGrouping: 'collapsed', turnOpen: true, deferCollapse: false, turnFolds: false })).toBe(true)
  })

  it('keeps a running Turn and the latest finished one flat in Normal, and everything flat in Verbose', () => {
    expect(groupOwnsHeader({ stepGrouping: 'history', turnOpen: true, deferCollapse: false, turnFolds: false })).toBe(false)
    expect(groupOwnsHeader({ stepGrouping: 'history', turnOpen: false, deferCollapse: true, turnFolds: false })).toBe(false)
    expect(groupOwnsHeader({ stepGrouping: 'none', ...finished, turnFolds: false })).toBe(false)
  })
})

describe('processTitle', () => {
  it('names up to three kinds of work', () => {
    expect(processTitle(summary('commands'), t)).toBe('Ran commands')
    expect(processTitle(summary('search', 'plan', 'commands'), t)).toBe('Searched code, updated the plan, ran commands')
  })

  it('never ends in "etc."', () => {
    const title = processTitle(summary('search', 'plan', 'commands', 'read'), t)
    expect(title).toBe('Searched code, updated the plan, ran commands and more')
    expect(title).not.toMatch(/etc\./)
  })
})
