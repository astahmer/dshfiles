import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { mcpServersApi, type ManagerSnapshot, type ServerDraft, type ServerView } from './api.js'
import { isClientActive } from './server-status.js'

const snapshotQueryKey = ['mcp-servers', 'snapshot'] as const

/**
 * Reads through `refresh`, not `list`: refresh reconciles the native clients and
 * restarts an exited local helper, which every open of the manager has always done.
 */
export const useServerSnapshot = () => {
  const api = useApi(mcpServersApi)
  return useQuery({
    queryKey: snapshotQueryKey,
    queryFn: ({ signal }) => api.refresh(undefined, { signal }),
    refetchOnMount: 'always',
  })
}

/** Every mutation answers with the full snapshot, so it replaces the cache instead of refetching through `refresh`. */
export const useServerActions = () => {
  const api = useApi(mcpServersApi)
  const queryClient = useQueryClient()
  const onSuccess = (snapshot: ManagerSnapshot): void => {
    queryClient.setQueryData(snapshotQueryKey, snapshot)
  }
  const save = useMutation({ mutationFn: (server: ServerDraft) => api.save({ server }), onSuccess })
  const toggleEnabled = useMutation({ mutationFn: (server: ServerView) => api.setEnabled({ id: server.id, enabled: !server.enabled }), onSuccess })
  const toggleConnection = useMutation({
    mutationFn: (server: ServerView) => api.setConnection({ id: server.id, connected: !isClientActive(server) }),
    onSuccess,
  })
  const remove = useMutation({ mutationFn: (server: ServerView) => api.remove({ id: server.id }), onSuccess })
  const mutations = [save, toggleEnabled, toggleConnection, remove]
  const resetErrors = (): void => {
    for (const mutation of mutations) if (mutation.isError) mutation.reset()
  }
  return {
    isPending: mutations.some(mutation => mutation.isPending),
    isRemoving: remove.isPending,
    failed: mutations.some(mutation => mutation.isError),
    resetErrors,
    /** Resolves whether the server was saved; a failure surfaces through `failed`. */
    save: (draft: ServerDraft): Promise<boolean> => {
      resetErrors()
      return save.mutateAsync(draft).then(
        () => true,
        () => false,
      )
    },
    toggleEnabled: (server: ServerView): void => {
      resetErrors()
      toggleEnabled.mutate(server)
    },
    toggleConnection: (server: ServerView): void => {
      resetErrors()
      toggleConnection.mutate(server)
    },
    remove: (input: { readonly server: ServerView; readonly onSettled: () => void }): void => {
      resetErrors()
      remove.mutate(input.server, { onSettled: input.onSettled })
    },
  }
}

export const useRegistrySearch = (query: string) => {
  const api = useApi(mcpServersApi)
  return useQuery({
    queryKey: ['mcp-servers', 'registry', query],
    queryFn: ({ signal }) => api.searchRegistry({ query }, { signal }),
    enabled: query.length > 0,
    retry: false,
  })
}
