import type { MutationFilters } from '@dshfiles/plugin-ui/query'
import { Schema } from 'effect'

const isLandingVariables = Schema.is(Schema.Struct({ path: Schema.String }))

/** Every land mutation carries `{ path }`, so a control can tell its own workspace's landing from another thread's. */
export class ThreadRebaseMutation {
  static readonly key = ['jj-integration', 'thread-rebase'] as const

  static readonly pathOf = (mutation: { readonly state: { readonly variables: unknown } }): string | undefined =>
    isLandingVariables(mutation.state.variables) ? mutation.state.variables.path : undefined

  static readonly at = (path: string): MutationFilters => ({
    mutationKey: ThreadRebaseMutation.key,
    predicate: mutation => ThreadRebaseMutation.pathOf(mutation) === path,
  })
}
