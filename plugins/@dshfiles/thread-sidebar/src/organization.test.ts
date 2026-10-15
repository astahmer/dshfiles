import { SessionId } from '@deepseek-ai/dsh-session/types'
import assert from 'node:assert/strict'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { test, vi } from 'vitest'
import { SidebarOrganization, type AutoArchiveContext, DEFAULT_PREFERENCES, type SidebarPreferences, type SidebarSection } from './organization.js'
import { decodePreferences, PREFERENCES_STORAGE_KEY, storedPreferences } from './preferences.js'

interface SessionFixture extends Partial<Omit<SessionSummary, 'id' | 'parentId'>> {
  id: string
  parentId?: string
}

const sessionSummary = ({ id, parentId, ...overrides }: SessionFixture): SessionSummary => {
  const summary: SessionSummary = { displayTitle: id, running: false, retainedBy: {}, blank: false, updatedAt: 0, ...overrides, id: SessionId(id) }
  return parentId === undefined ? summary : { ...summary, parentId: SessionId(parentId) }
}

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

test('subagent attention is opt-in and recognizes durable child links or origin', () => {
  assert.equal(DEFAULT_PREFERENCES.includeSubagentAttention, false)
  assert.equal(SidebarOrganization.isAttentionSessionIncluded(sessionSummary({ id: 'parent' }), false), true)
  assert.equal(SidebarOrganization.isAttentionSessionIncluded(sessionSummary({ id: 'child', parentId: 'parent' }), false), false)
  assert.equal(SidebarOrganization.isAttentionSessionIncluded(sessionSummary({ id: 'origin-child', origin: 'subagent' }), false), false)
  assert.equal(SidebarOrganization.isAttentionSessionIncluded(sessionSummary({ id: 'child', parentId: 'parent' }), true), true)
})

test('recent threads stay active until idle threshold; running and organization state keep priority', () => {
  const parkedIds = new Set(['parked'])
  const classify = (session: SessionSummary, overrides: { archived?: ReadonlySet<string>; pinned?: ReadonlySet<string>; parked?: ReadonlySet<string> } = {}) =>
    SidebarOrganization.sectionForSession({
      session,
      archivedSessionIds: overrides.archived ?? idSets.archivedSessionIds,
      pinnedSessionIds: overrides.pinned ?? idSets.pinnedSessionIds,
      parkedSessionIds: overrides.parked ?? parkedIds,
      now,
      idleMinutes: 120,
    })

  assert.equal(classify(sessionSummary({ id: 'recent', updatedAt: now - 119 * 60_000 })), 'active')
  assert.equal(classify(sessionSummary({ id: 'inactive', updatedAt: now - 120 * 60_000 })), 'inactive')
  assert.equal(classify(sessionSummary({ id: 'running', running: true, updatedAt: now - 240 * 60_000 })), 'active')
  assert.equal(classify(sessionSummary({ id: 'pinned', updatedAt: now }), { pinned: new Set(['pinned']) }), 'pinned')
  assert.equal(classify(sessionSummary({ id: 'parked', updatedAt: now })), 'parked')
  assert.equal(classify(sessionSummary({ id: 'archived', updatedAt: now }), { archived: new Set(['archived']) }), 'archived')
})

test('next idle transition ignores running sessions and returns earliest future boundary', () => {
  assert.equal(
    SidebarOrganization.nextIdleTransitionAt(
      [
        { running: false, updatedAt: now - 60 * 60_000 },
        { running: true, updatedAt: now + 60_000 },
        { running: false, updatedAt: now - 180 * 60_000 },
      ],
      now,
      120,
    ),
    now + 60 * 60_000,
  )
  assert.equal(SidebarOrganization.nextIdleTransitionAt([{ running: false, updatedAt: now - 120 * 60_000 }], now, 120), null)
})

test('auto archive requires an old, idle, nonblank, unpinned, unparked, included session', () => {
  const candidate: AutoArchiveContext = {
    session: sessionSummary({ id: 'idle', updatedAt: now - 120 * 60_000 }),
    workspaceId: 'project-a',
    now,
    preferences,
    ...idSets,
  }
  assert.equal(SidebarOrganization.isAutoArchiveCandidate(candidate), true)
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...candidate, session: { ...candidate.session, running: true } }), false)
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...candidate, session: { ...candidate.session, blank: true } }), false)
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...candidate, session: { ...candidate.session, updatedAt: now - 1 } }), false)
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...candidate, session: { ...candidate.session, updatedAt: now + 1 } }), false)
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...candidate, pinnedSessionIds: new Set(['idle']) }), false)
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...candidate, archivedSessionIds: new Set(['idle']) }), false)
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...candidate, preferences: { ...preferences, parkedSessionIds: ['idle'] } }), false)
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...candidate, preferences: { ...preferences, excludedSessionIds: ['idle'] } }), false)
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...candidate, preferences: { ...preferences, excludedWorkspaceIds: ['project-a'] } }), false)
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...candidate, preferences: { ...preferences, autoArchiveEnabled: false } }), false)
})

test('per-thread auto-archive override inherits, enables, disables, and resets without losing other overrides', () => {
  const idleCandidate: AutoArchiveContext = {
    session: sessionSummary({ id: 'thread', updatedAt: now - 120 * 60_000 }),
    workspaceId: undefined,
    now,
    preferences: DEFAULT_PREFERENCES,
    ...idSets,
  }
  assert.equal(SidebarOrganization.autoArchiveOverrideForSession(DEFAULT_PREFERENCES, 'thread'), 'inherit')
  assert.equal(SidebarOrganization.shouldScanForAutoArchive(DEFAULT_PREFERENCES), false)

  const enabled = SidebarOrganization.setAutoArchiveOverride(DEFAULT_PREFERENCES, 'thread', 'enabled')
  assert.equal(SidebarOrganization.autoArchiveOverrideForSession(enabled, 'thread'), 'enabled')
  assert.equal(SidebarOrganization.shouldScanForAutoArchive(enabled), true)
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...idleCandidate, preferences: enabled }), true)

  const disabled = SidebarOrganization.setAutoArchiveOverride(
    { ...preferences, autoArchiveSessionIds: ['other'], excludedSessionIds: ['globally-excluded'] },
    'thread',
    'disabled',
  )
  assert.equal(SidebarOrganization.autoArchiveOverrideForSession(disabled, 'thread'), 'disabled')
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...idleCandidate, preferences: disabled }), false)
  const inherited = SidebarOrganization.setAutoArchiveOverride(disabled, 'thread', 'inherit')
  assert.equal(SidebarOrganization.autoArchiveOverrideForSession(inherited, 'thread'), 'inherit')
  assert.deepEqual(inherited.autoArchiveSessionIds, ['other'])
  assert.deepEqual(inherited.autoArchiveDisabledSessionIds, [])
  assert.deepEqual(inherited.excludedSessionIds, ['globally-excluded'])
  assert.equal(SidebarOrganization.isAutoArchiveCandidate({ ...idleCandidate, preferences: { ...enabled, excludedSessionIds: ['thread'] } }), false)
  assert.equal(
    SidebarOrganization.isAutoArchiveCandidate({
      ...idleCandidate,
      workspaceId: 'excluded-project',
      preferences: { ...enabled, excludedWorkspaceIds: ['excluded-project'] },
    }),
    false,
  )
})

test('session exclusion input trims, splits, and deduplicates ids without logging them', () => {
  assert.deepEqual(SidebarOrganization.parseSessionIds(' s1, s2\ns1;\t s3 '), ['s1', 's2', 's3'])
  assert.deepEqual(SidebarOrganization.parseSessionIds(' , ;\n '), [])
})

test('session lineage preserves direct parent identity and computes unbounded parent depth safely', () => {
  const byId = {
    root: sessionSummary({ id: 'root', displayTitle: 'Parent' }),
    child: sessionSummary({ id: 'child', displayTitle: 'Child', parentId: 'root' }),
    grandchild: sessionSummary({ id: 'grandchild', displayTitle: 'Grandchild', parentId: 'child' }),
  }
  assert.deepEqual(SidebarOrganization.sessionLineage(byId.grandchild, byId), {
    depth: 2,
    parentId: 'child',
    parentTitle: 'Child',
  })
  assert.deepEqual(SidebarOrganization.sessionLineage(sessionSummary({ id: 'orphan', parentId: 'missing' }), {}), {
    depth: 1,
    parentId: 'missing',
    parentTitle: 'missing',
  })
  assert.equal(
    SidebarOrganization.sessionLineage(byId.child, {
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
  assert.equal(SidebarOrganization.workspaceForLineage(byId.grandchild, byId, new Map([['root', 'workspace-a']])), 'workspace-a')
  assert.equal(SidebarOrganization.workspaceForLineage(byId.grandchild, byId, new Map()), undefined)
})

test('invalid stored preference data is rejected without exposing the raw value', () => {
  const raw = '{"session":"private-session-id","newerVersion":true}'
  assert.equal(decodePreferences(JSON.parse(raw)), null)
})

test('navigation preferences preserve independent order, visibility, and header mode', () => {
  const stored = decodePreferences({
    ...DEFAULT_PREFERENCES,
    headerMode: 'expanded',
    headerOrder: ['panel:files', 'search'],
    hiddenHeaderIds: ['new-thread'],
    footerOrder: ['footer:tasks', 'settings'],
    hiddenFooterIds: ['footer:tasks'],
  })
  assert.ok(stored)
  assert.equal(stored.headerMode, 'expanded')
  assert.deepEqual(stored.headerOrder, ['panel:files', 'search'])
  assert.deepEqual(stored.hiddenHeaderIds, ['new-thread'])
  assert.deepEqual(stored.footerOrder, ['footer:tasks', 'settings'])
  assert.deepEqual(stored.hiddenFooterIds, ['footer:tasks'])
})

test('parked ids, sidebar settings, and navigation choices round-trip through browser storage', () => {
  const localStorage = new MemoryStorage()
  vi.stubGlobal('localStorage', localStorage)

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
    assert.equal(storedPreferences.set(saved), true)
    assert.notEqual(localStorage.getItem(PREFERENCES_STORAGE_KEY), null)
    storedPreferences.reload()
    assert.deepEqual(storedPreferences.get(), saved)
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
  const ordered = SidebarOrganization.orderSidebarEntries(entries, ['panel:files', 'new-thread'])
  assert.deepEqual(
    ordered.map(entry => entry.id),
    ['panel:files', 'new-thread', 'search'],
  )
  assert.deepEqual(SidebarOrganization.moveSidebarEntry(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(SidebarOrganization.moveSidebarEntry(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'])
  assert.deepEqual(SidebarOrganization.moveSidebarEntry(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c'])
})

test('drag reordering moves to the dropped index in both directions', () => {
  // Forward past the source must not skip a slot: removing index 0 then
  // inserting at the pre-move index 2 would land the entry back at 1.
  assert.deepEqual(SidebarOrganization.reorderSidebarEntry(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(SidebarOrganization.reorderSidebarEntry(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c'])
  assert.deepEqual(SidebarOrganization.reorderSidebarEntry(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c'])
})

test('a pointer drag drops past every other icon centre it crosses', () => {
  const centers = [16, 50, 84, 118]
  assert.equal(SidebarOrganization.dropIndexAt({ centers, fromIndex: 0, position: 90 }), 2)
  assert.equal(SidebarOrganization.dropIndexAt({ centers, fromIndex: 3, position: 10 }), 0)
  assert.equal(SidebarOrganization.dropIndexAt({ centers, fromIndex: 1, position: 52 }), 1)
  assert.equal(SidebarOrganization.dropIndexAt({ centers, fromIndex: 0, position: 500 }), 3)
})

test('reordering the icon row keeps hidden entries in their saved slots', () => {
  const orderedIds = ['new', 'hidden', 'search', 'panel:a', 'panel:b']
  const visibleIds = ['new', 'search', 'panel:a', 'panel:b']
  assert.deepEqual(SidebarOrganization.reorderVisibleEntry({ orderedIds, visibleIds, fromVisible: 3, toVisible: 0 }), [
    'panel:b',
    'new',
    'hidden',
    'search',
    'panel:a',
  ])
  assert.deepEqual(SidebarOrganization.reorderVisibleEntry({ orderedIds, visibleIds, fromVisible: 0, toVisible: 2 }), [
    'hidden',
    'search',
    'panel:a',
    'new',
    'panel:b',
  ])
  assert.deepEqual(SidebarOrganization.reorderVisibleEntry({ orderedIds, visibleIds, fromVisible: 9, toVisible: 0 }), orderedIds)
})

test('drag reordering ignores an out-of-range or non-integer index', () => {
  assert.deepEqual(SidebarOrganization.reorderSidebarEntry(['a', 'b', 'c'], -1, 1), ['a', 'b', 'c'])
  assert.deepEqual(SidebarOrganization.reorderSidebarEntry(['a', 'b', 'c'], 0, 9), ['a', 'b', 'c'])
  assert.deepEqual(SidebarOrganization.reorderSidebarEntry(['a', 'b', 'c'], 5, 0), ['a', 'b', 'c'])
  assert.deepEqual(SidebarOrganization.reorderSidebarEntry(['a', 'b', 'c'], 0.5, 1), ['a', 'b', 'c'])
  assert.deepEqual(SidebarOrganization.reorderSidebarEntry(['a', 'b', 'c'], Number.NaN, 1), ['a', 'b', 'c'])
})

test('archive adapter explicitly refuses to stop Host activity', async () => {
  let request
  await SidebarOrganization.archiveWithoutStopping(async (sessionId, options) => {
    request = { sessionId, options }
  }, 'session-1')
  assert.deepEqual(request, { sessionId: 'session-1', options: { stopActivity: false } })
})

test('footer and icon-row overflow keep whole items and reserve the More control only when something overflows', () => {
  assert.deepEqual(SidebarOrganization.fitItems({ widths: [80, 120], available: 208, gap: 8, reserve: 36 }), [true, true])
  assert.deepEqual(SidebarOrganization.fitItems({ widths: [80, 120], available: 200, gap: 8, reserve: 36 }), [true, false])
  assert.deepEqual(SidebarOrganization.fitItems({ widths: [80, 120, 40], available: 100, gap: 8, reserve: 36 }), [false, false, true])
  assert.deepEqual(SidebarOrganization.fitItems({ widths: [90, 250, 70], available: 260, gap: 8, reserve: 36 }), [true, false, true])
  assert.deepEqual(SidebarOrganization.fitItems({ widths: [], available: 0, gap: 8, reserve: 36 }), [])
})
