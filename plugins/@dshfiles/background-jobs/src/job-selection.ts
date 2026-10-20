import type { JobKill, JobRow } from './types.js'

export interface BatchStopOutcome {
  readonly requested: readonly string[]
  readonly skipped: readonly string[]
  readonly failed: readonly string[]
}

export class JobSelectionModel {
  /** Only live rows can be stopped; finished history stays selectable for nothing. */
  static stoppableIds(rows: readonly JobRow[]): string[] {
    return rows.filter(row => row.status === 'running' || row.status === 'stopping').map(row => row.id)
  }

  static async stop(input: { readonly ids: readonly string[]; readonly kill: (jobId: string) => Promise<JobKill> }): Promise<BatchStopOutcome> {
    const results = await Promise.allSettled(input.ids.map(id => input.kill(id)))
    const requested: string[] = []
    const skipped: string[] = []
    const failed: string[] = []
    results.forEach((result, index) => {
      const id = input.ids[index]
      if (id === undefined) return
      if (result.status === 'rejected') {
        failed.push(id)
        return
      }
      if (result.value.outcome === 'requested') requested.push(id)
      else skipped.push(id)
    })
    return { requested, skipped, failed }
  }
}
