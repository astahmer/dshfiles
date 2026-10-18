import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobEvent, JobView } from '@deepseek-ai/dsh-jobs'
import type { JobChunk } from '@deepseek-ai/dsh-jobs/view'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * The slice of `ctx.jobs` the board reads. The registry fences every read by
 * the owner, so a cross-Session board passes the owner back as the caller —
 * exactly what the stock per-Session job list does on a human's behalf.
 */
export interface JobRegistrySurface {
  readonly events: {
    subscribe(filter: { readonly owners: 'all' }, listener: (event: JobEvent) => void): () => void
  }
  readAt(id: JobId, from: number, caller?: SessionId): { readonly chunks: readonly JobChunk[]; readonly next: number; readonly lossy: boolean }
  kill(id: JobId, caller?: SessionId, reason?: string): 'requested' | 'already-finished'
}

/** Live jobs of every Session in this process, kept current from registry events. */
export interface LiveJobsOptions {
  readonly registry: JobRegistrySurface
  readonly onChange?: () => void
}

export class LiveJobs {
  private readonly views = new Map<string, JobView>()
  private readonly options: LiveJobsOptions
  private stop: (() => void) | null = null

  constructor(options: LiveJobsOptions) {
    this.options = options
  }

  start(): void {
    this.stop ??= this.options.registry.events.subscribe({ owners: 'all' }, event => this.apply(event))
  }

  dispose(): void {
    this.stop?.()
    this.stop = null
    this.views.clear()
  }

  get size(): number {
    return this.views.size
  }

  values(): readonly JobView[] {
    return [...this.views.values()]
  }

  view(id: string): JobView | undefined {
    return this.views.get(id)
  }

  private apply(event: JobEvent): void {
    if (event.type === 'removed') this.views.delete(event.job.id)
    else if (event.type === 'output') {
      const previous = this.views.get(event.id)
      if (previous !== undefined) this.views.set(event.id, { ...previous, output: { ...previous.output, total: event.total } })
    } else this.views.set(event.job.id, event.job)
    this.options.onChange?.()
  }
}
