import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { ExternalLinkIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect } from 'react'
import { aiAccountsApi, type CopilotLoginState } from './api.js'
import { useDeviceSignIn } from './device-sign-in.js'
import { beginLoginQuery } from './login-query.js'

export const CopilotSignIn = (props: {
  readonly instanceId: string
  readonly operationId?: string
  readonly signedIn: boolean
  readonly onConnected?: () => void
  readonly onCancelled?: () => void
}): JSX.Element => {
  const { instanceId, operationId } = props
  const accounts = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  const operation = operationId === undefined ? {} : { operationId }
  const queryKey =
    operationId === undefined ? (['ai-accounts', 'copilot-login', instanceId] as const) : (['ai-accounts', 'copilot-login', instanceId, operationId] as const)
  const { snapshot, send } = useDeviceSignIn({
    instanceId,
    ...(operationId !== undefined && { operationId }),
    ports: {
      begin: async () => {
        const next = await beginLoginQuery(queryClient, queryKey, () => accounts.beginCopilotLogin({ instanceId: instanceId, ...operation }))
        queryClient.setQueryData(queryKey, next)
        return next
      },
      cancel: async () => {
        await accounts.cancelCopilotLogin({ instanceId, confirm: true, ...operation })
      },
      signOut: async () => {
        await accounts.signOutCopilot({ instanceId: instanceId })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['ai-accounts', 'file'] }),
          queryClient.invalidateQueries({ queryKey: ['ai-accounts', 'usage'] }),
        ])
        queryClient.setQueryData(queryKey, {
          instanceId: instanceId,
          status: 'idle',
          userCode: null,
          verificationUri: null,
          message: 'GitHub Copilot was disconnected.',
        } satisfies CopilotLoginState)
      },
      onConnected: () => props.onConnected?.(),
      onCancelled: () => {
        props.onCancelled?.()
        void queryClient.invalidateQueries({ queryKey, exact: true })
      },
    },
  })
  const starting = snapshot.matches('starting')
  const statusQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => accounts.copilotLoginStatus({ instanceId: instanceId }, { signal }),
    enabled: !starting,
    refetchInterval: query => {
      const status = query.state.data?.status
      return status === 'starting' || status === 'waiting' ? 1_000 : false
    },
    staleTime: 1_000,
    retry: false,
  })
  const status: CopilotLoginState = statusQuery.data ?? {
    instanceId: instanceId,
    status: 'idle',
    userCode: null,
    verificationUri: null,
    message: null,
  }
  useEffect(() => {
    if (statusQuery.data === undefined) return
    send({ type: 'observed', status: statusQuery.data.status })
  }, [send, statusQuery.data])

  useEffect(() => {
    if (status.status !== 'complete') return
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ai-accounts', 'file'] }),
      queryClient.invalidateQueries({ queryKey: ['ai-accounts', 'usage'] }),
    ])
  }, [queryClient, status.status])

  const active = status.status === 'starting' || status.status === 'waiting'
  const error = snapshot.context.failure !== null || status.status === 'error'
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        {!props.signedIn ? (
          <Button disabled={starting || active} onClick={() => send({ type: 'begin' })} size="sm" type="button">
            {active ? 'Waiting for GitHub…' : status.status === 'error' ? 'Try sign-in again' : 'Sign in with GitHub'}
          </Button>
        ) : (
          <Button disabled={snapshot.matches('disconnecting')} onClick={() => send({ type: 'signOut' })} size="sm" type="button" variant="outline">
            {snapshot.matches('disconnecting') ? 'Disconnecting…' : 'Disconnect GitHub'}
          </Button>
        )}
        {active ? (
          <Button disabled={snapshot.matches('cancelling')} onClick={() => send({ type: 'cancel' })} size="sm" type="button" variant="outline">
            Cancel sign-in
          </Button>
        ) : null}
        {status.verificationUri === null ? null : (
          <a
            className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:text-sm dshx:underline"
            href={status.verificationUri}
            rel="noreferrer"
            target="_blank"
          >
            Open GitHub <ExternalLinkIcon />
          </a>
        )}
      </div>
      {status.userCode === null ? null : (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <code className="dshx:rounded dshx:bg-background dshx:px-2 dshx:py-1 dshx:font-mono! dshx:text-base dshx:font-semibold dshx:tracking-widest">
            {status.userCode}
          </code>
          <Button onClick={() => void writeClipboard(status.userCode ?? '')} size="xs" type="button" variant="outline">
            Copy code
          </Button>
        </div>
      )}
      {status.message === null ? null : (
        <p className={error ? 'dshx:text-xs dshx:text-destructive' : 'dshx:text-xs dshx:text-muted-foreground'} role="status">
          {status.message}
        </p>
      )}
      {snapshot.context.failure === null ? null : (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          Could not update GitHub Copilot sign-in. Try again.
        </p>
      )}
      {statusQuery.isError ? (
        <p className="dshx:text-xs dshx:text-muted-foreground" role="status">
          Sign-in status will refresh when the Host is available.
        </p>
      ) : null}
    </div>
  )
}
