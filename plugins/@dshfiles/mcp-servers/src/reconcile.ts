export interface ClientTarget {
  readonly id: string
  readonly enabled: boolean
  readonly ready: boolean
  readonly suspended?: boolean
  readonly fingerprint: string
}

export type ClientLifecycle = 'inactive' | 'starting' | 'loaded' | 'start-failed' | 'manually-disconnected'

/** Serializes native client start/stop transitions and replaces edited clients. */
export class ClientReconciler<Target extends ClientTarget = ClientTarget> {
  private readonly active = new Map<string, { fingerprint: string; dispose: () => void | Promise<void> }>()
  private readonly lifecycle = new Map<string, ClientLifecycle>()
  private pending: Promise<void> = Promise.resolve()

  constructor(private readonly start: (target: Target) => Promise<() => void | Promise<void>>) {}

  update(targets: readonly Target[]): Promise<void> {
    const run = this.pending.then(() => this.apply(targets))
    this.pending = run.catch(() => undefined)
    return run
  }

  /** Dispose and recreate one native client through its owning Cordis fiber. */
  restart(id: string, targets: readonly Target[]): Promise<void> {
    const run = this.pending.then(async () => {
      const current = this.active.get(id)
      if (current !== undefined) {
        this.active.delete(id)
        await current.dispose()
      }
      this.lifecycle.delete(id)
      await this.apply(targets)
    })
    this.pending = run.catch(() => undefined)
    return run
  }

  state(id: string): ClientLifecycle {
    return this.lifecycle.get(id) ?? 'inactive'
  }

  async dispose(): Promise<void> {
    await this.update([])
  }

  private async apply(targets: readonly Target[]): Promise<void> {
    const byId = new Map(targets.map(target => [target.id, target]))
    const desired = new Map(targets.filter(target => target.enabled && target.ready && target.suspended !== true).map(target => [target.id, target]))
    for (const [id, current] of this.active) {
      const next = desired.get(id)
      if (next === undefined || next.fingerprint !== current.fingerprint) {
        this.active.delete(id)
        await current.dispose()
      }
    }
    for (const [id, target] of byId) {
      if (target.suspended === true) this.lifecycle.set(id, 'manually-disconnected')
      else if (!target.enabled || !target.ready) this.lifecycle.set(id, 'inactive')
      else if (this.active.has(id)) this.lifecycle.set(id, 'loaded')
      else if (this.lifecycle.get(id) !== 'start-failed') this.lifecycle.set(id, 'starting')
    }
    for (const id of this.lifecycle.keys()) {
      if (!byId.has(id)) this.lifecycle.delete(id)
    }
    for (const [id, target] of desired) {
      if (this.active.has(id)) continue
      this.lifecycle.set(id, 'starting')
      try {
        const dispose = await this.start(target)
        this.active.set(id, { fingerprint: target.fingerprint, dispose })
        this.lifecycle.set(id, 'loaded')
      } catch {
        this.lifecycle.set(id, 'start-failed')
      }
    }
  }
}
