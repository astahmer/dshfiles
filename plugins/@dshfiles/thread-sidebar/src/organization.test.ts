import { SessionId } from '@deepseek-ai/dsh-session/types'
import assert from 'node:assert/strict'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { test, vi } from 'vitest'
import {
  archiveWithoutStopping,
  type AutoArchiveContext,
  DEFAULT_PREFERENCES,
  isAutoArchiveCandidate,
  moveSidebarEntry,
  reorderSidebarEntry,
  orderSidebarEntries,
  parseSessionIds,
  sessionLineage,
  sectionForSession,
  type SidebarPreferences,
  type SidebarSection,
  workspaceForLineage,
} from './organization.js'
import { loadPreferences, parseStoredPreferences, PREFERENCES_STORAGE_KEY, savePreferences } from './preferences.js'

interface SessionFixture extends Partial<Omit<SessionSummary, 'id' | 'parentId'>> {
  id: string
  parentId?: string
}

const sessionSummary = ({ id, parentId, ...overrides }: SessionFixture): SessionSummary => ({
  displayTitle: id,
  running: false,
  retainedBy: {},
  blank: false,
  updatedAt: 0,
  ...overrides,
  attention: overrides.attention ?? null,
  id: SessionId(id),
  parentId: parentId === undefined ? undefined : SessionId(parentId),
})

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>()

  get length(): number {
    return this.#values.size
  }

  clear = (): void => this.#values.clear()

  getItem = (key: string): string | null => this.#values.get(key) ?? null

  key = (index: number): string | null => [...this.#values.keys()][index] ?? null

  removeItem = (key: string): void => {
    this.#values.delete(key)
  }

  setItem = (key: string, value: string): void => {
    this.#values.set(key, value)
  }
}

const now = 10_000_000
const preferences: SidebarPreferences = { ...DEFAULT_PREFERENCES, autoArchiveEnabled: true }
const idSets = {
  archivedSessionIds: new Set<string>(),
  pinnedSessionIds: new Set<string>(),
}

test('archived starts folded and the working sections start open', () => {
  // Archived is storage rather than a place to work, so it opens folded; every
  // other section holds threads a user comes here to act on.
  assert.deepEqual(DEFAULT_PREFERENCES.collapsedSections, ['archived'])
  const workingSections = (['pinned', 'active', 'parked', 'inactive'] as const).filter(section => DEFAULT_PREFERENCES.collapsedSections.includes(section))
  assert.deepEqual(workingSections, [])
})

test('every default collapsed section is one the sidebar can actually render', () => {
  const known = new Set<SidebarSection>(['pinned', 'active', 'parked', 'inactive', 'archived'])
  for (const section of DEFAULT_PREFERENCES.collapsedSections) assert.ok(known.has(section), `unknown section ${section}`)
})

test('live running, pinned, parked, and archived state selects one stable sidebar section', () => {
  const parkedIds = new Set(['parked'])
  assert.equal(sectionForSession(sessionSummary({ id: 'running', running: true }), idSets.archivedSessionIds, idSets.pinnedSessionIds, parkedIds), 'active')
  assert.equal(sectionForSession(sessionSummary({ id: 'pinned', running: false }), idSets.archivedSessionIds, new Set(['pinned']), parkedIds), 'pinned')
  assert.equal(sectionForSession(sessionSummary({ id: 'parked', running: false }), idSets.archivedSessionIds, idSets.pinnedSessionIds, parkedIds), 'parked')
  assert.equal(sectionForSession(sessionSummary({ id: 'archived', running: false }), new Set(['archived']), idSets.pinnedSessionIds, parkedIds), 'archived')
})

test('auto archive requires an old, idle, nonblank, unpinned, unparked, included session', () => {
  const candidate: AutoArchiveContext = {
    session: sessionSummary({ id: 'idle', updatedAt: now - 120 * 60_000 }),
    workspaceId: 'project-a',
    now,
    preferences,
    ...idSets,
  }
  assert.equal(isAutoArchiveCandidate(candidate), true)
  assert.equal(isAutoArchiveCandidate({ ...candidate, session: { ...candidate.session, running: true } }), false)
  assert.equal(isAutoArchiveCandidate({ ...candidate, session: { ...candidate.session, blank: true } }), false)
  assert.equal(isAutoArchiveCandidate({ ...candidate, session: { ...candidate.session, updatedAt: now - 1 } }), false)
  assert.equal(isAutoArchiveCandidate({ ...candidate, session: { ...candidate.session, updatedAt: now + 1 } }), false)
  assert.equal(isAutoArchiveCandidate({ ...candidate, pinnedSessionIds: new Set(['idle']) }), false)
  assert.equal(isAutoArchiveCandidate({ ...candidate, archivedSessionIds: new Set(['idle']) }), false)
  assert.equal(isAutoArchiveCandidate({ ...candidate, preferences: { ...preferences, parkedSessionIds: ['idle'] } }), false)
  assert.equal(isAutoArchiveCandidate({ ...candidate, preferences: { ...preferences, excludedSessionIds: ['idle'] } }), false)
  assert.equal(isAutoArchiveCandidate({ ...candidate, preferences: { ...preferences, excludedWorkspaceIds: ['project-a'] } }), false)
  assert.equal(isAutoArchiveCandidate({ ...candidate, preferences: { ...preferences, autoArchiveEnabled: false } }), false)
})

test('session exclusion input trims, splits, and deduplicates ids without logging them', () => {
  assert.deepEqual(parseSessionIds(' s1, s2\ns1;\t s3 '), ['s1', 's2', 's3'])
  assert.deepEqual(parseSessionIds(' , ;\n '), [])
})

test('session lineage preserves direct parent identity and computes unbounded parent depth safely', () => {
  const byId = {
    root: sessionSummary({ id: 'root', displayTitle: 'Parent' }),
    child: sessionSummary({ id: 'child', displayTitle: 'Child', parentId: 'root' }),
    grandchild: sessionSummary({ id: 'grandchild', displayTitle: 'Grandchild', parentId: 'child' }),
  }
  assert.deepEqual(sessionLineage(byId.grandchild, byId), {
    depth: 2,
    parentId: 'child',
    parentTitle: 'Child',
  })
  assert.deepEqual(sessionLineage(sessionSummary({ id: 'orphan', parentId: 'missing' }), {}), {
    depth: 1,
    parentId: 'missing',
    parentTitle: 'missing',
  })
  assert.equal(
    sessionLineage(byId.child, {
      ...byId,
      root: { ...byId.root, parentId: SessionId('child') },
    }).depth,
    1,
  )
})

test('child threads inherit the nearest known workspace through the parent chain', () => {
  const byId = {
    root: sessionSummary({ id: 'root' }),
    child: sessionSummary({ id: 'child', parentId: 'root' }),
    grandchild: sessionSummary({ id: 'grandchild', parentId: 'child' }),
  }
  assert.equal(workspaceForLineage(byId.grandchild, byId, new Map([['root', 'workspace-a']])), 'workspace-a')
  assert.equal(workspaceForLineage(byId.grandchild, byId, new Map()), undefined)
})

test('invalid stored preference data is rejected without exposing the raw value', () => {
  const raw = '{"session":"private-session-id","newerVersion":true}'
  assert.deepEqual(parseStoredPreferences(raw), DEFAULT_PREFERENCES)
  assert.deepEqual(parseStoredPreferences(null), DEFAULT_PREFERENCES)
})

test('navigation preferences preserve independent order, visibility, and header mode', () => {
  const stored = parseStoredPreferences(
    JSON.stringify({
      ...DEFAULT_PREFERENCES,
      headerMode: 'expanded',
      headerOrder: ['panel:files', 'search'],
      hiddenHeaderIds: ['new-thread'],
      footerOrder: ['footer:tasks', 'settings'],
      hiddenFooterIds: ['footer:tasks'],
    }),
  )
  assert.equal(stored.headerMode, 'expanded')
  assert.deepEqual(stored.headerOrder, ['panel:files', 'search'])
  assert.deepEqual(stored.hiddenHeaderIds, ['new-thread'])
  assert.deepEqual(stored.footerOrder, ['footer:tasks', 'settings'])
  assert.deepEqual(stored.hiddenFooterIds, ['footer:tasks'])
})

test('parked ids, settlement settings, and navigation choices round-trip through browser storage', () => {
  const localStorage = new MemoryStorage()
  vi.stubGlobal('window', { localStorage })

  try {
    const saved: SidebarPreferences = {
      ...DEFAULT_PREFERENCES,
      autoArchiveEnabled: true,
      idleMinutes: 240,
      scanIntervalMinutes: 20,
      parkedSessionIds: ['parked-session'],
      headerMode: 'expanded',
      footerOrder: ['footer:tasks', 'settings'],
      hiddenFooterIds: ['footer:tasks'],
    }
    assert.equal(savePreferences(saved), true)
    assert.notEqual(localStorage.getItem(PREFERENCES_STORAGE_KEY), null)
    assert.deepEqual(loadPreferences(), saved)
  } finally {
    vi.unstubAllGlobals()
  }
})

test('header and footer entries use saved ordering and boundary-safe movement', () => {
  const entries = [
    { id: 'new-thread', order: -2 },
    { id: 'search', order: -1 },
    { id: 'panel:files', order: 0 },
  ]
  const ordered = orderSidebarEntries(entries, ['panel:files', 'new-thread'])
  assert.deepEqual(
    ordered.map(entry => entry.id),
    ['panel:files', 'new-thread', 'search'],
  )
  assert.deepEqual(moveSidebarEntry(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(moveSidebarEntry(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'])
  assert.deepEqual(moveSidebarEntry(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c'])
})

test('drag reordering moves to the dropped index in both directions', () => {
  // Forward past the source must not skip a slot: removing index 0 then
  // inserting at the pre-move index 2 would land the entry back at 1.
  assert.deepEqual(reorderSidebarEntry(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(reorderSidebarEntry(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c'])
  assert.deepEqual(reorderSidebarEntry(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c'])
})

test('drag reordering ignores an out-of-range or non-integer index', () => {
  assert.deepEqual(reorderSidebarEntry(['a', 'b', 'c'], -1, 1), ['a', 'b', 'c'])
  assert.deepEqual(reorderSidebarEntry(['a', 'b', 'c'], 0, 9), ['a', 'b', 'c'])
  assert.deepEqual(reorderSidebarEntry(['a', 'b', 'c'], 5, 0), ['a', 'b', 'c'])
  assert.deepEqual(reorderSidebarEntry(['a', 'b', 'c'], 0.5, 1), ['a', 'b', 'c'])
  assert.deepEqual(reorderSidebarEntry(['a', 'b', 'c'], Number.NaN, 1), ['a', 'b', 'c'])
})

test('archive adapter explicitly refuses to stop Host activity', async () => {
  let request
  await archiveWithoutStopping(async (sessionId, options) => {
    request = { sessionId, options }
  }, 'session-1')
  assert.deepEqual(request, { sessionId: 'session-1', options: { stopActivity: false } })
})
