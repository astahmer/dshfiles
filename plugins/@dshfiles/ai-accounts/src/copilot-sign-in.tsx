import { setupOperationId } from './account-setup-controller.js'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { ExternalLinkIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useRef, useState } from 'react'
import { aiAccountsApi, type CopilotLoginState } from './api.js'
import { beginLoginQuery } from './login-query.js'

export const CopilotSignIn = (props: { readonly instanceId: string; readonly signedIn: boolean; readonly onConnected?: () => void }): JSX.Element => {
  const { instanceId, onConnected } = props
  const [requestId] = useState(setupOperationId)
  const accounts = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  const queryKey = ['ai-accounts', 'copilot-login', instanceId] as const
  const alive = useRef(true)
  const ownsAttempt = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (ownsAttempt.current) void accounts.cancelCopilotLogin({ instanceId, confirm: true, requestId }).catch(() => undefined)
    }
  }, [accounts, instanceId, requestId])
  const begin = useMutation({
    mutationFn: () => beginLoginQuery(queryClient, queryKey, () => accounts.beginCopilotLogin({ instanceId: instanceId, requestId })),
    onSuccess: next => {
      ownsAttempt.current = next.status === 'starting' || next.status === 'waiting'
      if (!alive.current) {
        if (ownsAttempt.current) void accounts.cancelCopilotLogin({ instanceId, confirm: true, requestId }).catch(() => undefined)
        return
      }
      queryClient.setQueryData(queryKey, next)
    },
  })
  const statusQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => accounts.copilotLoginStatus({ instanceId: instanceId }, { signal }),
    enabled: !begin.isPending,
    refetchInterval: query => {
      const status = query.state.data?.status
      return status === 'starting' || status === 'waiting' ? 1_000 : false
    },
    retry: false,
  })
  const status: CopilotLoginState = statusQuery.data ?? {
    instanceId: instanceId,
    status: 'idle',
    userCode: null,
    verificationUri: null,
    message: null,
  }
  const cancel = useMutation({
    mutationFn: () => accounts.cancelCopilotLogin({ instanceId, confirm: true, requestId }),
    onSuccess: () =>
      queryClient.setQueryData(queryKey, {
        instanceId: instanceId,
        status: 'idle',
        userCode: null,
        verificationUri: null,
        message: 'GitHub sign-in was cancelled.',
      } satisfies CopilotLoginState),
  })
  const signOut = useMutation({
    mutationFn: () => accounts.signOutCopilot({ instanceId: instanceId }),
    onSuccess: async () => {
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
  })

  useEffect(() => {
    if (status.status !== 'complete') return
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ai-accounts', 'file'] }),
      queryClient.invalidateQueries({ queryKey: ['ai-accounts', 'usage'] }),
    ])
  }, [queryClient, status.status])

  const connected = useRef(false)
  useEffect(() => {
    if (status.status === 'complete' && begin.isSuccess && !connected.current) {
      connected.current = true
      ownsAttempt.current = false
      onConnected?.()
    }
  }, [status.status, begin.isSuccess, onConnected])

  const active = status.status === 'starting' || status.status === 'waiting'
  const error = begin.error !== null || cancel.error !== null || signOut.error !== null || status.status === 'error'
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        {!props.signedIn ? (
          <Button disabled={begin.isPending || active} onClick={() => begin.mutate()} size="sm" type="button">
            {active ? 'Waiting for GitHub…' : status.status === 'error' ? 'Try sign-in again' : 'Sign in with GitHub'}
          </Button>
        ) : (
          <Button disabled={signOut.isPending} onClick={() => signOut.mutate()} size="sm" type="button" variant="outline">
            {signOut.isPending ? 'Disconnecting…' : 'Disconnect GitHub'}
          </Button>
        )}
        {active ? (
          <Button disabled={cancel.isPending} onClick={() => cancel.mutate()} size="sm" type="button" variant="outline">
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
      {begin.isError || cancel.isError || signOut.isError ? (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          Could not update GitHub Copilot sign-in. Try again.
        </p>
      ) : null}
      {statusQuery.isError ? (
        <p className="dshx:text-xs dshx:text-muted-foreground" role="status">
          Sign-in status will refresh when the Host is available.
        </p>
      ) : null}
    </div>
  )
}
