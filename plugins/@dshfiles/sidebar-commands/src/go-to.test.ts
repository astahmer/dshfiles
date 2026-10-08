import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { describe, expect, it, vi } from 'vitest'
import { buildGoToEntries, createDeferredNavigation } from './go-to.js'

const copy = {
  panelsGroup: 'Panels',
  sessionsGroup: 'Sessions',
  panelDetail: 'Panel',
  sessionDetail: 'Session',
  actionsGroup: 'Actions',
  actionDetail: 'Thread sidebar',
  paletteLabel: 'Open command palette',
  threadSearchLabel: 'Search threads',
}

const session = (id: string, fields: Partial<Pick<SessionSummary, 'blank' | 'origin' | 'cwd' | 'updatedAt' | 'displayTitle'>> = {}) => ({
  id,
  displayTitle: fields.displayTitle ?? id,
  blank: fields.blank ?? false,
  updatedAt: fields.updatedAt ?? 0,
  cwd: fields.cwd,
  origin: fields.origin,
})

type Row = ReturnType<typeof session>

const sessionsOf = (rows: readonly Row[]) => ({ ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])) })

const build = (overrides: Partial<Parameters<typeof buildGoToEntries<string>>[0]> = {}) =>
  buildGoToEntries<string>({ panels: [], mainPanelKeys: new Set(), sessions: undefined, archivedSessionIds: new Set(), paletteAvailable: false, copy, ...overrides })

describe('buildGoToEntries', () => {
  it('leads with palette actions only when the thread sidebar acknowledged the palette', () => {
    expect(build().length).toBe(0)
    const entries = build({ paletteAvailable: true })
    expect(entries.map(entry => entry.target)).toEqual([
      { kind: 'palette', mode: 'all' },
      { kind: 'palette', mode: 'threads' },
    ])
    expect(entries[0]?.option.group).toEqual({ name: 'actions', label: 'Actions' })
  })

  it('lists only panels whose id is a registered main panel, sorted by label', () => {
    const entries = build({
      panels: [
        { id: 'plugins', label: 'Plugins' },
        { id: 'jujutsu', label: 'Jujutsu' },
        { id: 'orphan', label: 'No main panel' },
        { id: undefined, label: 'Missing id' },
      ],
      mainPanelKeys: new Set(['plugins', 'jujutsu']),
    })
    expect(entries.map(entry => entry.option.label)).toEqual(['Jujutsu', 'Plugins'])
    expect(entries[0]?.target).toEqual({ kind: 'panel', panelId: 'jujutsu' })
    expect(entries[0]?.option.group).toEqual({ name: 'panels', label: 'Panels' })
  })

  it('falls back to the panel id when the label is blank', () => {
    const entries = build({ panels: [{ id: 'docs', label: '  ' }], mainPanelKeys: new Set(['docs']) })
    expect(entries[0]?.option.label).toBe('docs')
  })

  it('hides blank, subagent and archived sessions and orders the rest by recency', () => {
    const rows = [
      session('old', { updatedAt: 1, cwd: '/work/old' }),
      session('blank', { blank: true, updatedAt: 9 }),
      session('child', { origin: 'subagent', updatedAt: 8 }),
      session('archived', { updatedAt: 7 }),
      session('recent', { updatedAt: 5, displayTitle: 'Recent work' }),
    ]
    const entries = build({ sessions: sessionsOf(rows), archivedSessionIds: new Set(['archived']) })
    expect(entries.map(entry => entry.option.label)).toEqual(['Recent work', 'old'])
    expect(entries[0]?.option.detail).toBe('Session')
    expect(entries[1]?.option.detail).toBe('/work/old')
    expect(entries[1]?.target).toEqual({ kind: 'session', sessionId: 'old' })
  })

  it('caps the session list at twenty rows', () => {
    const rows = Array.from({ length: 25 }, (_, index) => session(`s${index}`, { updatedAt: index }))
    const entries = build({ sessions: sessionsOf(rows) })
    expect(entries).toHaveLength(20)
    expect(entries[0]?.target).toEqual({ kind: 'session', sessionId: 's24' })
  })

  it('returns no sessions before the list snapshot lands', () => {
    expect(build()).toEqual([])
  })
})

describe('createDeferredNavigation', () => {
  const setup = (available: boolean) => {
    const scheduled: Array<() => void> = []
    const navigate = vi.fn()
    const select = createDeferredNavigation({
      isAvailable: () => available,
      unavailableMessage: target => `${target} is gone`,
      navigate,
      schedule: run => void scheduled.push(run),
    })
    return { select, navigate, scheduled }
  }

  it('navigates only after onSelect has returned, so the shell can consume the token first', () => {
    const { select, navigate, scheduled } = setup(true)
    select('jujutsu')
    expect(navigate).not.toHaveBeenCalled()
    scheduled.forEach(run => run())
    expect(navigate).toHaveBeenCalledWith('jujutsu')
  })

  it('throws synchronously for a target that disappeared, scheduling nothing', () => {
    const { select, scheduled } = setup(false)
    expect(() => select('jujutsu')).toThrow('jujutsu is gone')
    expect(scheduled).toHaveLength(0)
  })
})
