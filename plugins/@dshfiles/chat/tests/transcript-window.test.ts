// @vitest-environment jsdom
import type { RenderEntry } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TranscriptWindow, useTranscriptWindow } from '../src/transcript-window.ts'

// SAFETY: test rows only need the `kind`/`key` shape the window reads; keys are opaque brands at runtime.
const rows = (count: number): RenderEntry[] => Array.from({ length: count }, (_, index) => ({ kind: 'node', key: `n${index}` }) as RenderEntry)
const seqOf = (entry: RenderEntry): number => (Number(entry.key.slice(1)) + 1) * 10

const renderWindow = (initial: { entries: RenderEntry[]; anchor?: string | null; hasMore?: boolean; following?: boolean }) => {
  const loadOlder = vi.fn()
  const loadThrough = vi.fn((_seq: SessionSeq) => Promise.resolve())
  const hook = renderHook(
    (props: { entries: RenderEntry[] }) =>
      useTranscriptWindow({
        ready: true,
        following: () => initial.following ?? false,
        entries: props.entries,
        seqOf,
        members: () => [],
        savedAnchor: () => initial.anchor ?? null,
        hasMore: initial.hasMore ?? false,
        loadOlder,
        loadThrough,
      }),
    { initialProps: { entries: initial.entries } },
  )
  return { ...hook, loadOlder, loadThrough }
}

describe('TranscriptWindow', () => {
  it('mounts the latest rows first and widens toward older rows', () => {
    const view = renderWindow({ entries: rows(100) })
    expect(view.result.current.entries[0]?.key).toBe('n76')
    expect(view.result.current.hidden).toBe(76)
    expect(view.result.current.hasMore).toBe(true)

    act(() => view.result.current.loadOlder())
    expect(view.result.current.entries[0]?.key).toBe('n52')
    expect(view.loadOlder).not.toHaveBeenCalled()
  })

  it('asks the Host for older pages only once every loaded row is mounted', () => {
    const view = renderWindow({ entries: rows(30), hasMore: true })
    act(() => view.result.current.loadOlder())
    expect(view.result.current.hidden).toBe(0)
    expect(view.loadOlder).not.toHaveBeenCalled()

    act(() => view.result.current.loadOlder())
    expect(view.loadOlder).toHaveBeenCalledOnce()
  })

  it('keeps the rows the reader sees mounted while newer rows stream in', () => {
    const view = renderWindow({ entries: rows(100) })
    view.rerender({ entries: rows(110) })
    expect(view.result.current.entries[0]?.key).toBe('n76')
    expect(view.result.current.entries).toHaveLength(34)
  })

  it('slides with the newest rows while the reader follows them', () => {
    const view = renderWindow({ entries: rows(100), following: true })
    view.rerender({ entries: rows(110) })
    expect(view.result.current.entries[0]?.key).toBe('n86')
    expect(view.result.current.entries).toHaveLength(24)
  })

  it('widens to a Turn jump target without asking the Host when the row is loaded', async () => {
    const view = renderWindow({ entries: rows(100) })
    await act(() => view.result.current.loadThrough(SessionSeq(205)))
    expect(view.result.current.entries[0]?.key).toBe('n18')
    expect(view.loadThrough).not.toHaveBeenCalled()

    await act(() => view.result.current.loadThrough(SessionSeq(5)))
    expect(view.loadThrough).toHaveBeenCalledWith(5)
    expect(view.result.current.hidden).toBe(0)
  })

  it('opens with a restored reading anchor mounted', () => {
    const view = renderWindow({ entries: rows(100), anchor: '["n40","response"]' })
    expect(view.result.current.entries[0]?.key).toBe('n16')
  })

  it('recognizes the anchor keys of a node, a node part and a group', () => {
    const members = (): readonly string[] => ['m1', 'm2']
    // SAFETY: shape-only test rows, as above.
    const node = { kind: 'node', key: 'n1' } as RenderEntry
    // SAFETY: shape-only test rows, as above.
    const group = { kind: 'group', key: 'g1' } as RenderEntry
    expect(TranscriptWindow.holdsAnchor(node, 'n1', members)).toBe(true)
    expect(TranscriptWindow.holdsAnchor(node, '["n1","process"]', members)).toBe(true)
    expect(TranscriptWindow.holdsAnchor(node, 'n10', members)).toBe(false)
    expect(TranscriptWindow.holdsAnchor(group, 'group:g1', members)).toBe(true)
    expect(TranscriptWindow.holdsAnchor(group, '["m2","response"]', members)).toBe(true)
  })
})
