import { expect, it } from 'vitest'
import type { ResourcePoolEntry, ResourceSnapshot } from './api.js'
import { ResourceSnapshotModel } from './resource-snapshot.js'

const snapshot = ({
  loadAverage1m,
  cpuCount,
  memoryFreeBytes,
  memoryTotalBytes = 100,
}: {
  readonly loadAverage1m: number | null
  readonly cpuCount: number
  readonly memoryFreeBytes: number
  readonly memoryTotalBytes?: number
}): ResourceSnapshot => ({
  sampledAt: '2026-10-28T05:00:00.000Z',
  platform: 'linux',
  cpuCount,
  loadAverage1m,
  memoryTotalBytes,
  memoryFreeBytes,
})

const entry = ({
  hostId,
  hostName,
  runtimeId,
  snapshot: resources,
  stale = false,
  hidden = false,
}: {
  readonly hostId: string
  readonly hostName: string
  readonly runtimeId: string
  readonly snapshot: ResourceSnapshot
  readonly stale?: boolean
  readonly hidden?: boolean
}): ResourcePoolEntry => ({
  hostId,
  hostName,
  runtimeId,
  destination: { kind: 'runtime', runtimeId },
  hidden,
  probe: { ok: true, snapshot: resources },
  stale,
  refreshing: false,
})

it('ranks hosts by their highest normalized CPU or memory pressure', () => {
  const cpuPressured = snapshot({ loadAverage1m: 4, cpuCount: 8, memoryFreeBytes: 80 })
  const memoryPressured = snapshot({ loadAverage1m: 1, cpuCount: 8, memoryFreeBytes: 20 })

  expect(ResourceSnapshotModel.resourcePressureScore(cpuPressured)).toBe(0.5)
  expect(ResourceSnapshotModel.resourcePressureScore(memoryPressured)).toBe(0.8)
  expect(
    ResourceSnapshotModel.selectAutoHost([
      entry({ hostId: 'cpu', hostName: 'CPU host', runtimeId: 'runtime-cpu', snapshot: cpuPressured }),
      entry({ hostId: 'memory', hostName: 'Memory host', runtimeId: 'runtime-memory', snapshot: memoryPressured }),
    ]),
  ).toEqual({ hostId: 'cpu', hostName: 'CPU host', runtimeId: 'runtime-cpu', score: 0.5 })
})

it('keeps directory order as the deterministic tie-break and skips hidden or stale hosts', () => {
  const equal = snapshot({ loadAverage1m: 1, cpuCount: 4, memoryFreeBytes: 75 })

  expect(
    ResourceSnapshotModel.selectAutoHost([
      entry({ hostId: 'hidden', hostName: 'Hidden', runtimeId: 'runtime-hidden', snapshot: equal, hidden: true }),
      entry({ hostId: 'stale', hostName: 'Stale', runtimeId: 'runtime-stale', snapshot: equal, stale: true }),
      entry({ hostId: 'first', hostName: 'First', runtimeId: 'runtime-first', snapshot: equal }),
      entry({ hostId: 'second', hostName: 'Second', runtimeId: 'runtime-second', snapshot: equal }),
    ]),
  ).toMatchObject({ hostId: 'first', runtimeId: 'runtime-first' })
})

it('limits concurrent remote resource probes', async () => {
  const limiter = ResourceSnapshotModel.createResourceProbeLimiter(2)
  let active = 0
  let maximum = 0

  await Promise.all(
    Array.from({ length: 8 }, () =>
      limiter.run(async () => {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise(resolve => setTimeout(resolve, 1))
        active -= 1
      }),
    ),
  )

  expect(maximum).toBe(2)
})

it('returns no candidate when snapshots are unavailable or unsupported', () => {
  const noLoad = snapshot({ loadAverage1m: null, cpuCount: 4, memoryFreeBytes: 80 })
  const unavailable: ResourcePoolEntry = {
    hostId: 'offline',
    hostName: 'Offline',
    runtimeId: 'runtime-offline',
    destination: { kind: 'runtime', runtimeId: 'runtime-offline' },
    hidden: false,
    probe: { ok: false, code: 'offline', message: 'Unavailable.' },
    stale: false,
    refreshing: false,
  }

  expect(ResourceSnapshotModel.resourcePressureScore(noLoad)).toBeUndefined()
  expect(
    ResourceSnapshotModel.selectAutoHost([
      entry({ hostId: 'unsupported', hostName: 'Unsupported', runtimeId: 'runtime-unsupported', snapshot: noLoad }),
      unavailable,
    ]),
  ).toBeNull()
})
