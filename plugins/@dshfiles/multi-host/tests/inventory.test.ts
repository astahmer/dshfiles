import { describe, expect, test } from 'vitest'
import type { RemoteThreadSummary, RuntimeStatus } from '../src/api.js'
import { mergeInventory, type InventoryStatus } from '../src/inventory.js'

const startedHere = (input: { runtimeId: string; sessionId: string; title: string; createdAt: string }): RemoteThreadSummary => ({
  runtimeId: input.runtimeId,
  sessionId: input.sessionId,
  cwd: '/work/app',
  title: input.title,
  createdAt: input.createdAt,
  hostName: 'Build box',
  connected: true,
})

const session = (input: {
  runtimeId: string
  sessionId: string
  updatedAt: number
  running?: boolean
  blank?: boolean
  cwd?: string
}) => ({
  runtimeId: input.runtimeId,
  sessionId: input.sessionId,
  ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
  running: input.running ?? false,
  blank: input.blank ?? false,
  updatedAt: input.updatedAt,
})

const reachable = (input: {
  runtimeId: string
  hostName: string
  sessions: readonly ReturnType<typeof session>[]
}): InventoryStatus => ({
  runtimeId: input.runtimeId,
  hostName: input.hostName,
  status: {
    ok: true,
    runtime: {
      id: input.runtimeId,
      hostId: 'host',
      name: input.hostName,
      identity: null,
      connected: true,
    },
    workspaces: [],
    sessions: input.sessions,
  } satisfies RuntimeStatus,
})

const unreachable = (input: { runtimeId: string; hostName: string }): InventoryStatus => ({
  runtimeId: input.runtimeId,
  hostName: input.hostName,
  status: {
    ok: false,
    hostId: 'host',
    runtimeId: input.runtimeId,
    code: 'gateway-unreachable',
    message: 'The host did not answer.',
    stale: true,
  } satisfies RuntimeStatus,
})

describe('remote inventory merge', () => {
  test('a thread in both sources appears once with its stored title and started-here flag', () => {
    const rows = mergeInventory({
      startedHere: [startedHere({ runtimeId: 'runtime-a', sessionId: 'session-1', title: 'Fix the build', createdAt: '2026-10-20T08:00:00.000Z' })],
      statuses: [reachable({ runtimeId: 'runtime-a', hostName: 'Build box', sessions: [session({ runtimeId: 'runtime-a', sessionId: 'session-1', updatedAt: 1_000 })] })],
    })
    expect(rows).toEqual([
      {
        runtimeId: 'runtime-a',
        sessionId: 'session-1',
        hostName: 'Build box',
        title: 'Fix the build',
        cwd: '/work/app',
        running: false,
        updatedAt: 1_000,
        startedHere: true,
      },
    ])
  })

  test('the same session id on two runtimes appears twice', () => {
    const rows = mergeInventory({
      startedHere: [],
      statuses: [
        reachable({ runtimeId: 'runtime-a', hostName: 'Build box', sessions: [session({ runtimeId: 'runtime-a', sessionId: 'session-1', updatedAt: 1 })] }),
        reachable({ runtimeId: 'runtime-b', hostName: 'Laptop', sessions: [session({ runtimeId: 'runtime-b', sessionId: 'session-1', updatedAt: 2 })] }),
      ],
    })
    expect(rows.map(row => [row.runtimeId, row.sessionId])).toEqual([
      ['runtime-b', 'session-1'],
      ['runtime-a', 'session-1'],
    ])
  })

  test('blank sessions never reach the list', () => {
    const rows = mergeInventory({
      startedHere: [],
      statuses: [
        reachable({
          runtimeId: 'runtime-a',
          hostName: 'Build box',
          sessions: [
            session({ runtimeId: 'runtime-a', sessionId: 'blank', updatedAt: 2, blank: true }),
            session({ runtimeId: 'runtime-a', sessionId: 'used', updatedAt: 1, cwd: '/work/app' }),
          ],
        }),
      ],
    })
    expect(rows.map(row => row.sessionId)).toEqual(['used'])
  })

  test('a failed status keeps the host’s started-here rows', () => {
    const rows = mergeInventory({
      startedHere: [startedHere({ runtimeId: 'runtime-a', sessionId: 'session-1', title: 'Fix the build', createdAt: '2026-10-20T08:00:00.000Z' })],
      statuses: [unreachable({ runtimeId: 'runtime-a', hostName: 'Build box' })],
    })
    expect(rows).toEqual([
      {
        runtimeId: 'runtime-a',
        sessionId: 'session-1',
        hostName: 'Build box',
        title: 'Fix the build',
        cwd: '/work/app',
        running: false,
        updatedAt: Date.parse('2026-10-20T08:00:00.000Z'),
        startedHere: true,
      },
    ])
  })

  test('rows sort by updated time, newest first', () => {
    const rows = mergeInventory({
      startedHere: [startedHere({ runtimeId: 'runtime-a', sessionId: 'started', title: 'Started here', createdAt: '2026-10-20T08:00:00.000Z' })],
      statuses: [
        reachable({
          runtimeId: 'runtime-a',
          hostName: 'Build box',
          sessions: [
            session({ runtimeId: 'runtime-a', sessionId: 'older', updatedAt: 2_000 }),
            session({ runtimeId: 'runtime-a', sessionId: 'started', updatedAt: 1_000 }),
            session({ runtimeId: 'runtime-a', sessionId: 'newest', updatedAt: 3_000 }),
          ],
        }),
      ],
    })
    expect(rows.map(row => row.sessionId)).toEqual(['newest', 'older', 'started'])
    expect(rows.at(-1)?.startedHere).toBe(true)
  })
})
