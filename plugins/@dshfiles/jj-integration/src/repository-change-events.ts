import type { pluginQueryClient } from '@dshfiles/plugin-ui/query'

type PluginQueryClient = ReturnType<typeof pluginQueryClient>

/**
 * Round three item 28: the Host says when a jj operation changed a repository (`repositoryChanged`, from its watch of
 * the store's operation heads), naming its thread workspaces. Every view of one of those threads (the header and its
 * Land, the turn-end offer, the transcript markers) reads its status again at once instead of on its idle poll, so Land
 * appears within a second of `jj describe`. Threads of other repositories are left alone, and a read already running
 * is not restarted.
 */
export const followRepositoryChanges = (input: {
  readonly subscribe: (onEvent: (payload: { readonly paths: readonly string[] }) => void) => () => void
  readonly queryClient: PluginQueryClient
}): (() => void) =>
  input.subscribe(payload => {
    const changed = new Set(payload.paths)
    void input.queryClient.invalidateQueries(
      { queryKey: ['jj-integration', 'thread'], predicate: query => changed.has(String(query.queryKey[2])) },
      { cancelRefetch: false },
    )
  })
