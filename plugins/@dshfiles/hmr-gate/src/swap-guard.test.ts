import { describe, expect, it } from 'vitest'
import { createQuietReload, SwapGuard, type GuardRow } from './swap-guard.js'

const rows: GuardRow[] = [
  // As the live graph has them: ui-session injects the contract row, not the fork that provides `sessions`.
  { id: '@deepseek-ai/dsh-client-ui-session', rev: 'a', inject: ['@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-client-ui-renderer'] },
  { id: '@deepseek-ai/dsh-api-session-controller', rev: 'a', inject: [] },
  { id: '@dshfiles/session-controller', rev: 'a', inject: ['@deepseek-ai/dsh-api-gateway'] },
  { id: '@deepseek-ai/dsh-client-ui-renderer', rev: 'a', inject: [] },
  { id: '@deepseek-ai/dsh-api-gateway', rev: 'a', inject: [] },
  { id: '@dshfiles/shared-runtime', rev: 'a', inject: [] },
  { id: '@dshfiles/ui-styles', rev: 'a', inject: ['@dshfiles/shared-runtime'] },
]
const graph = (changes: Record<string, string>, release = '1') => ({
  type: 'graph' as const,
  graph: {
    release: { version: release },
    entries: rows.map(row => ({ id: row.id, rev: changes[row.id] ?? row.rev, url: 'u', inject: row.inject })),
  },
})

describe('SwapGuard', () => {
  it('names the session scope owner and everything it injects, transitively', () => {
    expect([...SwapGuard.unsafeIds(rows)].sort()).toEqual([
      '@deepseek-ai/dsh-api-gateway',
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-session',
      '@dshfiles/session-controller',
    ])
  })

  it('reloads for a rebuilt Session Controller, and keeps the live swap for an unrelated plugin', () => {
    expect(SwapGuard.rebuiltNeedsReload(rows, '@dshfiles/session-controller')).toBe(true)
    expect(SwapGuard.rebuiltNeedsReload(rows, '@dshfiles/ui-styles')).toBe(false)
  })

  it('reloads for a graph that changes an unsafe row, and leaves other graphs and other releases to the stock path', () => {
    const current = { rows, release: '1' }
    expect(SwapGuard.graphNeedsReload(current, graph({}))).toBe(false)
    expect(SwapGuard.graphNeedsReload(current, graph({ '@dshfiles/ui-styles': 'b' }))).toBe(false)
    expect(SwapGuard.graphNeedsReload(current, graph({ '@dshfiles/session-controller': 'b' }))).toBe(true)
    expect(SwapGuard.graphNeedsReload(current, graph({ '@dshfiles/session-controller': 'b' }, '2'))).toBe(false)
    expect(SwapGuard.graphNeedsReload(current, { type: 'graph', graph: { nope: true } })).toBe(false)
  })

  it('names the packages a graph replaces, and none for the graph the page already runs or another release', () => {
    const current = { rows, release: '1' }
    expect(SwapGuard.graphChanges(current, graph({}))).toEqual([])
    expect(SwapGuard.graphChanges(current, graph({ '@dshfiles/ui-styles': 'b', '@dshfiles/shared-runtime': 'c' }))).toEqual([
      '@dshfiles/shared-runtime',
      '@dshfiles/ui-styles',
    ])
    expect(SwapGuard.graphChanges(current, graph({ '@dshfiles/ui-styles': 'b' }, '2'))).toEqual([])
  })
})

describe('quiet reload', () => {
  const page = (state: { hidden: boolean; editing: boolean }) => {
    let reloads = 0
    const listeners = new Set<() => void>()
    const request = createQuietReload({
      hidden: () => state.hidden,
      editing: () => state.editing,
      onSettle: listener => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      reload: () => (reloads += 1),
    })
    return { request, settle: () => [...listeners].forEach(listener => listener()), reloads: () => reloads, listening: () => listeners.size }
  }

  it('reloads at once when nobody is typing, once for several requests', () => {
    const tab = page({ hidden: false, editing: false })
    tab.request()
    tab.request()
    expect(tab.reloads()).toBe(1)
    expect(tab.listening()).toBe(0)
  })

  it('waits while the user types, then reloads when the field loses focus', () => {
    const state = { hidden: false, editing: true }
    const tab = page(state)
    tab.request()
    expect(tab.reloads()).toBe(0)
    tab.settle()
    expect(tab.reloads()).toBe(0)
    state.editing = false
    tab.settle()
    expect(tab.reloads()).toBe(1)
  })
})
