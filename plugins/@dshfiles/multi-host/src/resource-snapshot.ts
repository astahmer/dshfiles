import { cpus, freemem, loadavg, platform, totalmem } from 'node:os'
import type { ResourcePoolEntry, ResourceSelection, ResourceSnapshot } from './api.js'

export class ResourceSnapshotModel {
  static readonly createResourceProbeLimiter = (maximumConcurrent: number) => {
    if (!Number.isInteger(maximumConcurrent) || maximumConcurrent < 1) throw new RangeError('At least one resource probe must be allowed.')
    let active = 0
    const waiting: Array<() => void> = []

    return {
      run: async <Result>(operation: () => Promise<Result>): Promise<Result> => {
        if (active >= maximumConcurrent) await new Promise<void>(resolve => waiting.push(resolve))
        active += 1
        try {
          return await operation()
        } finally {
          active -= 1
          waiting.shift()?.()
        }
      },
    }
  }

  static readonly readResourceSnapshot = (): ResourceSnapshot => {
    const currentPlatform = platform()
    return {
      sampledAt: new Date().toISOString(),
      platform: currentPlatform,
      cpuCount: cpus().length,
      loadAverage1m: currentPlatform === 'win32' ? null : (loadavg().at(0) ?? null),
      memoryTotalBytes: totalmem(),
      memoryFreeBytes: freemem(),
    }
  }

  static readonly resourcePressureScore = (snapshot: ResourceSnapshot): number | undefined => {
    if (snapshot.cpuCount === 0 || snapshot.loadAverage1m === null || snapshot.memoryTotalBytes === 0) return undefined
    return Math.max(snapshot.loadAverage1m / snapshot.cpuCount, 1 - snapshot.memoryFreeBytes / snapshot.memoryTotalBytes)
  }

  static readonly selectAutoHost = (entries: readonly ResourcePoolEntry[]): ResourceSelection | null => {
    let selected: ResourceSelection | undefined
    for (const entry of entries) {
      if (entry.hidden || entry.stale || entry.destination === null || !entry.probe.ok) continue
      const score = ResourceSnapshotModel.resourcePressureScore(entry.probe.snapshot)
      if (score === undefined) continue
      if (selected === undefined || score < selected.score) {
        selected = {
          hostId: entry.hostId,
          hostName: entry.hostName,
          runtimeId: entry.destination.runtimeId,
          score,
        }
      }
    }
    return selected ?? null
  }
}
