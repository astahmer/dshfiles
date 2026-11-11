import { afterEach, describe, expect, it } from 'vitest'
import { PromptHistoryTargets } from './prompt-history-targets.js'

const field = { nodeType: 1 }

const frame = (input: { readonly visible: boolean; readonly holds?: { readonly nodeType: number } }) => ({
  isConnected: true,
  getClientRects: () => (input.visible ? [{}] : []),
  contains: (other: { readonly nodeType: number } | null) => other === input.holds,
})

const releases: (() => void)[] = []
afterEach(() => {
  for (const release of releases.splice(0)) release()
})

const target = (input: { readonly visible: boolean; readonly holds?: { readonly nodeType: number } }) => {
  const opened: string[] = []
  const entry = { frame: () => frame(input), open: () => opened.push('open') }
  releases.push(PromptHistoryTargets.register(entry))
  return { entry, opened }
}

describe('PromptHistoryTargets.open', () => {
  it('treats only a bare Ctrl+R as the history key', () => {
    const key = (input: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({
      key: 'r',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...input,
    })
    expect(PromptHistoryTargets.isHistoryKey(key({ ctrlKey: true }))).toBe(true)
    expect(PromptHistoryTargets.isHistoryKey(key({ metaKey: true }))).toBe(false)
    expect(PromptHistoryTargets.isHistoryKey(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  it('opens only the focused composer when asked for the focused one', () => {
    const other = target({ visible: true })
    const focused = target({ visible: true, holds: field })

    expect(PromptHistoryTargets.open({ focusedOnly: true, active: field })).toBe(true)
    expect(focused.opened).toEqual(['open'])
    expect(other.opened).toEqual([])
    expect(PromptHistoryTargets.open({ focusedOnly: true, active: null })).toBe(false)
  })

  it('opens the last composer used from the palette, skipping hidden ones', () => {
    const first = target({ visible: true })
    const hidden = target({ visible: false })
    const second = target({ visible: true })
    PromptHistoryTargets.touch(first.entry)

    expect(PromptHistoryTargets.open({ focusedOnly: false, active: null })).toBe(true)
    expect(first.opened).toEqual(['open'])
    expect(second.opened).toEqual([])
    expect(hidden.opened).toEqual([])
  })

  it('reports nothing to open once every composer unregistered', () => {
    target({ visible: true })
    for (const release of releases.splice(0)) release()
    expect(PromptHistoryTargets.open({ focusedOnly: false, active: null })).toBe(false)
  })
})
