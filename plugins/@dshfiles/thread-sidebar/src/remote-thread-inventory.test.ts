import { expect, test } from 'vitest'
import { buildRemoteSidebarThreads, filterRemoteSidebarThreads, runtimesWithStartedThreads } from './remote-thread-inventory.js'

const status = {
  ok: true,
  runtime: { id: 'runtime-a', hostId: 'host-a', name: 'Runtime A', identity: null, connected: true },
  workspaces: [{ runtimeId: 'runtime-a', workspaceId: 'workspace-a', path: '/work/Atlas', title: 'Atlas', sessionIds: ['live-thread'] }],
  sessions: [
    { runtimeId: 'runtime-a', sessionId: 'live-thread', cwd: '/work/Atlas', title: 'Live thread', running: true, blank: false, updatedAt: 1735689600400 },
    { runtimeId: 'runtime-a', sessionId: 'host-thread', cwd: '/work/Other', title: 'Host thread', running: false, blank: false, updatedAt: 1735689600300 },
    { runtimeId: 'runtime-a', sessionId: 'blank-thread', cwd: '/work/Atlas', running: false, blank: true, updatedAt: 500 },
  ],
} satisfies Awaited<ReturnType<import('@dshfiles/multi-host/destination').MultiHostClient['runtimeStatus']>>

test('only probes runtimes that own started-here threads', () => {
  const runtimes = [{ id: 'runtime-a' }, { id: 'runtime-b' }, { id: 'runtime-c' }]
  expect(runtimesWithStartedThreads(runtimes, [{ runtimeId: 'runtime-c' }, { runtimeId: 'runtime-a' }, { runtimeId: 'runtime-c' }])).toEqual([
    runtimes[0],
    runtimes[2],
  ])
  expect(runtimesWithStartedThreads(runtimes, [])).toEqual([])
})

test('remote inventory enriches started-here threads without adding host-only sessions', () => {
  const rows = buildRemoteSidebarThreads({
    startedHere: [
      {
        runtimeId: 'runtime-a',
        sessionId: 'live-thread',
        cwd: '/work/Atlas',
        title: 'Stored title',
        createdAt: '2025-01-01T00:00:00.000Z',
        hostName: 'Build host',
        connected: false,
      },
      {
        runtimeId: 'runtime-a',
        sessionId: 'stored-only',
        cwd: '/work/Atlas',
        title: 'Stored only',
        createdAt: '2025-01-01T00:00:00.000Z',
        hostName: 'Build host',
        connected: false,
      },
      {
        runtimeId: 'runtime-a',
        sessionId: 'blank-thread',
        cwd: '/work/Atlas',
        title: 'Empty remote thread',
        createdAt: '2025-01-01T00:00:00.000Z',
        hostName: 'Build host',
        connected: false,
      },
    ],
    statuses: [{ runtimeId: 'runtime-a', hostName: 'Build host', status }],
  })

  expect(rows).toMatchObject([
    {
      sessionId: 'live-thread',
      title: 'Live thread',
      hostName: 'Build host',
      connected: true,
      running: true,
      updatedAt: 1735689600400,
      workspaceId: 'remote-project:runtime-a:workspace-a',
      workspaceTitle: 'Atlas',
    },
    {
      sessionId: 'stored-only',
      title: 'Stored only',
      connected: false,
      running: false,
      updatedAt: Date.parse('2025-01-01T00:00:00.000Z'),
      workspaceId: 'remote-project:runtime-a:Atlas',
    },
  ])
  expect(rows.some(row => row.sessionId === 'host-thread' || row.sessionId === 'blank-thread')).toBe(false)
})

test('remote rows respect settled status and source filters', () => {
  const threads = [
    {
      runtimeId: 'runtime-a',
      sessionId: 'settled-thread',
      title: 'Settled',
      cwd: '/work/Atlas',
      hostName: 'Build host',
      connected: true,
      running: false,
      updatedAt: 3,
      workspaceId: 'remote-project:runtime-a:Atlas',
      workspaceTitle: 'Atlas',
    },
    {
      runtimeId: 'runtime-a',
      sessionId: 'active-thread',
      title: 'Active',
      cwd: '/work/Atlas',
      hostName: 'Build host',
      connected: true,
      running: false,
      updatedAt: 2,
      workspaceId: 'remote-project:runtime-a:Atlas',
      workspaceTitle: 'Atlas',
    },
  ]

  expect(
    filterRemoteSidebarThreads({
      threads,
      filters: ['not-running'],
      sourceFilter: 'all',
      archivedSessionIds: new Set(),
      settledSessionIds: new Set(['settled-thread']),
      mutedSessionIds: new Set(),
    }).map(thread => thread.sessionId),
  ).toEqual(['active-thread'])
  expect(
    filterRemoteSidebarThreads({
      threads,
      filters: [],
      sourceFilter: 'subagents',
      archivedSessionIds: new Set(),
      settledSessionIds: new Set(),
      mutedSessionIds: new Set(),
    }),
  ).toEqual([])
})
