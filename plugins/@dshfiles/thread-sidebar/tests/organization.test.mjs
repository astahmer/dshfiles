import assert from 'node:assert/strict'
import test from 'node:test'
import {
  archiveWithoutStopping,
  DEFAULT_PREFERENCES,
  isAutoArchiveCandidate,
  moveSidebarEntry,
  orderSidebarEntries,
  parseSessionIds,
  sessionLineage,
  sectionForSession,
  workspaceForLineage,
} from '../.test-dist/organization.js'
import {
  loadPreferences,
  parseStoredPreferences,
  PREFERENCES_STORAGE_KEY,
  savePreferences,
} from '../.test-dist/preferences.js'

const now = 10_000_000
const preferences = { ...DEFAULT_PREFERENCES, autoArchiveEnabled: true }
const idSets = {
  archivedSessionIds: new Set(),
  pinnedSessionIds: new Set(),
}

test('live running, pinned, parked, and archived state selects one stable sidebar section', () => {
  const parkedIds = new Set(['parked'])
  assert.equal(sectionForSession({ id: 'running', running: true }, idSets.archivedSessionIds, idSets.pinnedSessionIds, parkedIds), 'active')
  assert.equal(sectionForSession({ id: 'pinned', running: false }, idSets.archivedSessionIds, new Set(['pinned']), parkedIds), 'pinned')
  assert.equal(sectionForSession({ id: 'parked', running: false }, idSets.archivedSessionIds, idSets.pinnedSessionIds, parkedIds), 'parked')
  assert.equal(sectionForSession({ id: 'archived', running: false }, new Set(['archived']), idSets.pinnedSessionIds, parkedIds), 'archived')
})

test('auto archive requires an old, idle, nonblank, unpinned, unparked, included session', () => {
  const candidate = {
    session: { id: 'idle', running: false, blank: false, updatedAt: now - 120 * 60_000 },
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
    root: { id: 'root', displayTitle: 'Parent', parentId: undefined },
    child: { id: 'child', displayTitle: 'Child', parentId: 'root' },
    grandchild: { id: 'grandchild', displayTitle: 'Grandchild', parentId: 'child' },
  }
  assert.deepEqual(sessionLineage(byId.grandchild, byId), {
    depth: 2,
    parentId: 'child',
    parentTitle: 'Child',
  })
  assert.deepEqual(sessionLineage({ id: 'orphan', parentId: 'missing' }, {}), {
    depth: 1,
    parentId: 'missing',
    parentTitle: 'missing',
  })
  assert.equal(sessionLineage(byId.child, {
    ...byId,
    root: { ...byId.root, parentId: 'child' },
  }).depth, 1)
})

test('child threads inherit the nearest known workspace through the parent chain', () => {
  const byId = {
    root: { id: 'root', parentId: undefined },
    child: { id: 'child', parentId: 'root' },
    grandchild: { id: 'grandchild', parentId: 'child' },
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
  const stored = parseStoredPreferences(JSON.stringify({
    ...DEFAULT_PREFERENCES,
    headerMode: 'expanded',
    headerOrder: ['panel:files', 'search'],
    hiddenHeaderIds: ['new-thread'],
    footerOrder: ['footer:tasks', 'settings'],
    hiddenFooterIds: ['footer:tasks'],
  }))
  assert.equal(stored.headerMode, 'expanded')
  assert.deepEqual(stored.headerOrder, ['panel:files', 'search'])
  assert.deepEqual(stored.hiddenHeaderIds, ['new-thread'])
  assert.deepEqual(stored.footerOrder, ['footer:tasks', 'settings'])
  assert.deepEqual(stored.hiddenFooterIds, ['footer:tasks'])
})

test('parked ids, settlement settings, and navigation choices round-trip through browser storage', () => {
  const values = new Map()
  const previousWindow = globalThis.window
  globalThis.window = {
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  }

  try {
    const saved = {
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
    assert.equal(values.has(PREFERENCES_STORAGE_KEY), true)
    assert.deepEqual(loadPreferences(), saved)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('header and footer entries use saved ordering and boundary-safe movement', () => {
  const entries = [
    { id: 'new-thread', order: -2 },
    { id: 'search', order: -1 },
    { id: 'panel:files', order: 0 },
  ]
  const ordered = orderSidebarEntries(entries, ['panel:files', 'new-thread'])
  assert.deepEqual(ordered.map(entry => entry.id), ['panel:files', 'new-thread', 'search'])
  assert.deepEqual(moveSidebarEntry(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(moveSidebarEntry(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'])
  assert.deepEqual(moveSidebarEntry(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c'])
})

test('archive adapter explicitly refuses to stop Host activity', async () => {
  let request
  await archiveWithoutStopping(async (sessionId, options) => {
    request = { sessionId, options }
  }, 'session-1')
  assert.deepEqual(request, { sessionId: 'session-1', options: { stopActivity: false } })
})
