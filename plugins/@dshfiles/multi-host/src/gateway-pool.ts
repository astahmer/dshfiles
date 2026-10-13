import type { Gateway } from './connectors/gateway.js'

/** One live connection per runtime, shared by every caller until it idles out or its transport drops. */
type PoolEntry = {
  readonly generation: number
  readonly gateway: Promise<Gateway>
  leases: number
  idleTimer: ReturnType<typeof setTimeout> | undefined
}

export type PooledGateway = { readonly gateway: Gateway; readonly generation: number; release(): void }

export const createGatewayPool = ({
  connect,
  idleMs = 5 * 60_000,
}: {
  /** Opens and verifies a new gateway; never given a caller's signal, because the connection outlives the caller. */
  readonly connect: (runtimeId: string) => Promise<Gateway>
  readonly idleMs?: number
}) => {
  const entries = new Map<string, PoolEntry>()
  let nextGeneration = 1

  const evict = (runtimeId: string, entry: PoolEntry): void => {
    if (entries.get(runtimeId) !== entry) return
    entries.delete(runtimeId)
    if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer)
    void entry.gateway.then(gateway => gateway.dispose()).catch(() => undefined)
  }

  const scheduleIdle = (runtimeId: string, entry: PoolEntry): void => {
    if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer)
    entry.idleTimer = entry.leases > 0 ? undefined : setTimeout(() => evict(runtimeId, entry), idleMs)
    entry.idleTimer?.unref?.()
  }

  const acquire = async (runtimeId: string): Promise<PooledGateway> => {
    let entry = entries.get(runtimeId)
    if (entry === undefined) {
      const created: PoolEntry = { generation: nextGeneration++, gateway: connect(runtimeId), leases: 0, idleTimer: undefined }
      entries.set(runtimeId, created)
      created.gateway.then(
        gateway => void gateway.closed.then(() => evict(runtimeId, created)),
        () => evict(runtimeId, created),
      )
      entry = created
    }
    const current = entry
    current.leases += 1
    scheduleIdle(runtimeId, current)
    let gateway: Gateway
    try {
      gateway = await current.gateway
    } catch (error) {
      current.leases -= 1
      throw error
    }
    let released = false
    return {
      gateway,
      generation: current.generation,
      release: () => {
        if (released) return
        released = true
        current.leases -= 1
        if (entries.get(runtimeId) === current) scheduleIdle(runtimeId, current)
      },
    }
  }

  return {
    acquire,
    /** Drop a connection a caller found broken, unless a newer generation already replaced it. */
    invalidate: (runtimeId: string, generation: number): void => {
      const entry = entries.get(runtimeId)
      if (entry?.generation === generation) evict(runtimeId, entry)
    },
    status: (runtimeId: string): { readonly connected: boolean; readonly generation: number } | undefined => {
      const entry = entries.get(runtimeId)
      return entry === undefined ? undefined : { connected: true, generation: entry.generation }
    },
    close: async (runtimeId?: string): Promise<void> => {
      const targets = [...entries.entries()].filter(([id]) => runtimeId === undefined || id === runtimeId)
      for (const [id, entry] of targets) evict(id, entry)
      await Promise.all(targets.map(([, entry]) => entry.gateway.then(gateway => gateway.dispose()).catch(() => undefined)))
    },
  }
}

export type GatewayPool = ReturnType<typeof createGatewayPool>
