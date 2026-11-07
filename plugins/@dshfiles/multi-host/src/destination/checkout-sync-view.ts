import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'
import type { MultiHostClient } from './queries.js'

type CheckoutSyncResponse = Awaited<ReturnType<MultiHostClient['checkoutSync']>>
export type CheckoutSyncReport = Extract<CheckoutSyncResponse, { readonly status: string }>

const maxSuggestions = 6

/** Recent checkouts per ssh target: nothing lists a host's repositories, so what was synced before is the shortlist. */
export const recentCheckouts = createStoredValue({
  key: 'dshfiles.multi-host.checkout-sync.recent',
  schema: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  fallback: {},
})

export class CheckoutSyncView {
  static rememberCheckout(input: { readonly recent: Readonly<Record<string, readonly string[]>>; readonly sshTarget: string; readonly path: string }) {
    const paths = [input.path, ...(input.recent[input.sshTarget] ?? []).filter(path => path !== input.path)].slice(0, maxSuggestions)
    return { ...input.recent, [input.sshTarget]: paths }
  }

  /** Recent checkouts first, then where this machine's threads run on that host. */
  static suggestedCheckouts(input: { readonly recent: readonly string[]; readonly threadFolders: readonly string[] }) {
    return [...new Set([...input.recent, ...input.threadFolders])].slice(0, maxSuggestions)
  }

  /** A Host that has not loaded this version answers with another shape, or a failure: both read as a message. */
  static reportOf(response: CheckoutSyncResponse | undefined) {
    if (response === undefined) return { report: undefined, problem: undefined }
    if ('status' in response) return { report: response, problem: undefined }
    if ('message' in response) return { report: undefined, problem: response.message }
    return { report: undefined, problem: 'This DSH has not loaded checkout sync yet. Restart it, then check again.' }
  }

  static syncLabel(report: CheckoutSyncReport): string {
    return `Sync ${report.incoming.total} incoming revision${report.incoming.total === 1 ? '' : 's'}`
  }

  static isRefusal(report: CheckoutSyncReport): boolean {
    return !report.ok && report.status !== 'failed' && report.status !== 'fetch-failed'
  }
}
