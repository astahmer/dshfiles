import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { decodeSnapshot, mcpServersApi, type ManagerPreferences, type ManagerSnapshot, type ServerDraft, type ServerView } from './api.js'
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
    select: decodeSnapshot,
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
  const signOut = useMutation({ mutationFn: (server: ServerView) => api.signOut({ id: server.id }), onSuccess })
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null)
  const authorize = useMutation({
    mutationFn: (input: { readonly server: ServerView; readonly popup: Window | null }) =>
      api.authorize({ id: input.server.id, origin: window.location.origin }),
    onSuccess: (result, input) => {
      if (input.popup !== null && !input.popup.closed) {
        input.popup.location.replace(result.authorizationUrl)
        return
      }
      setAuthorizationUrl(result.authorizationUrl)
    },
    onError: (_error, input) => input.popup?.close(),
  })
  const mutations = [save, toggleEnabled, toggleConnection, remove, signOut, authorize]
  const resetErrors = (): void => {
    for (const mutation of mutations) if (mutation.isError) mutation.reset()
  }
  return {
    isPending: mutations.some(mutation => mutation.isPending),
    isRemoving: remove.isPending,
    /** Shown when the browser blocked the sign-in tab, so the user can continue from a link. */
    authorizationUrl,
    dismissAuthorization: (): void => setAuthorizationUrl(null),
    /** Opens the provider tab synchronously inside the click so popup blockers allow it, then points it at the authorization URL. */
    signIn: (server: ServerView): void => {
      resetErrors()
      setAuthorizationUrl(null)
      const popup = window.open('about:blank', '_blank')
      if (popup !== null) popup.opener = null
      authorize.mutate({ server, popup })
    },
    signOut: (server: ServerView): void => {
      resetErrors()
      signOut.mutate(server)
    },
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
    /** Saves a hosted endpoint and, for OAuth servers, starts sign-in in a tab opened within the same click. */
    addHosted: (draft: ServerDraft): Promise<boolean> => {
      resetErrors()
      setAuthorizationUrl(null)
      const oauth = draft.transport === 'streamable-http' && draft.auth === 'oauth'
      const popup = oauth ? window.open('about:blank', '_blank') : null
      if (popup !== null) popup.opener = null
      return save.mutateAsync(draft).then(
        raw => {
          const snapshot = decodeSnapshot(raw)
          const server = snapshot.servers.find(candidate => candidate.serverName === draft.serverName)
          if (oauth && server !== undefined) authorize.mutate({ server, popup })
          else popup?.close()
          return true
        },
        () => {
          popup?.close()
          return false
        },
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

/** Saves the manager preferences; the answer is the full snapshot, like every other mutation. */
export const useSavePreferences = () => {
  const api = useApi(mcpServersApi)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (preferences: ManagerPreferences) => api.setPreferences({ preferences }),
    onSuccess: (snapshot: ManagerSnapshot) => {
      queryClient.setQueryData(snapshotQueryKey, snapshot)
    },
  })
}

export const useRegistrySearch = (query: string, enabled: boolean) => {
  const api = useApi(mcpServersApi)
  return useQuery({
    queryKey: ['mcp-servers', 'registry', query],
    queryFn: ({ signal }) => api.searchRegistry({ query }, { signal }),
    enabled: enabled && query.length >= 2,
    retry: false,
  })
}

export type ServerActions = ReturnType<typeof useServerActions>
