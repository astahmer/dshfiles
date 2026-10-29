import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef } from 'react'
import { aiAccountsLoginApi } from './account-login-api.js'
import { beginLoginQuery } from './login-query.js'

/** The official CLI owns credentials; only validated device instructions reach the browser. */
export const CodexSignIn = (props: {
  readonly instanceId: string
  readonly operationId?: string
  readonly replaceExisting?: boolean
  readonly onConnected: () => void
  readonly onCancelled?: () => void
}): JSX.Element => {
  const { instanceId, onConnected, operationId } = props
  const api = useApi(aiAccountsLoginApi)
  const client = useQueryClient()
  const operation = props.operationId === undefined ? {} : { operationId: props.operationId }
  const key =
    props.operationId === undefined
      ? (['ai-accounts', 'codex-login', instanceId] as const)
      : (['ai-accounts', 'codex-login', instanceId, props.operationId] as const)
  const completed = useRef(false)
  const alive = useRef(true)
  const ownsAttempt = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (ownsAttempt.current)
        void api.cancel({ instanceId: instanceId, confirm: true, ...(operationId !== undefined && { operationId }) }).catch(() => undefined)
    }
  }, [api, instanceId, operationId])
  const begin = useMutation({
    mutationFn: () =>
      beginLoginQuery(client, key, () => api.begin({ instanceId, ...operation, ...(props.replaceExisting === true && { replaceExisting: true }) })),
    onSuccess: next => {
      ownsAttempt.current = next.status === 'starting' || next.status === 'waiting'
      if (!alive.current) {
        if (ownsAttempt.current) void api.cancel({ instanceId: instanceId, confirm: true, ...operation }).catch(() => undefined)
        return
      }
      client.setQueryData(key, next)
    },
  })
  const status = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.status({ instanceId: instanceId }, { signal }),
    enabled: !begin.isPending,
    refetchInterval: query => (query.state.data?.status === 'starting' || query.state.data?.status === 'waiting' ? 1_000 : false),
    retry: false,
  })
  const cancel = useMutation({
    mutationFn: () => api.cancel({ instanceId: instanceId, confirm: true, ...operation }),
    onSuccess: () => {
      ownsAttempt.current = false
      props.onCancelled?.()
      return client.invalidateQueries({ queryKey: key, exact: true })
    },
  })
  useEffect(() => {
    if (status.data?.status === 'complete' && begin.isSuccess && !completed.current) {
      completed.current = true
      ownsAttempt.current = false
      onConnected()
    }
  }, [status.data?.status, begin.isSuccess, onConnected])
  const active = status.data?.status === 'starting' || status.data?.status === 'waiting'
  return (
    <section className="dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:p-4">
      <p className="dshx:text-sm dshx:text-muted-foreground">
        Approve sign-in on OpenAI. Codex keeps credentials in a private staging home until sign-in succeeds. Closing setup cancels pending sign-in.
      </p>
      {props.replaceExisting ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">
          Continuing replaces this profile’s login only after successful approval. Cancellation preserves the existing login.
        </p>
      ) : null}
      {status.data?.userCode ? (
        <div className="dshx:flex dshx:items-center dshx:gap-3">
          <code className="dshx:font-mono! dshx:text-lg dshx:font-semibold dshx:tracking-widest">{status.data.userCode}</code>
          <Button variant="outline" size="sm" onClick={() => void writeClipboard(status.data?.userCode ?? '')}>
            Copy code
          </Button>
        </div>
      ) : null}
      {status.data?.verificationUri ? (
        <a className="dshx:text-sm dshx:font-medium dshx:text-primary dshx:underline" href={status.data.verificationUri} target="_blank" rel="noreferrer">
          Continue on OpenAI
        </a>
      ) : null}
      <p role="status" className="dshx:text-sm dshx:text-muted-foreground">
        {status.data?.message ?? (begin.isPending ? 'Starting Codex sign-in…' : 'Ready to connect.')}
      </p>
      {status.isError || begin.isError || cancel.isError ? (
        <p role="alert" className="dshx:text-sm dshx:text-destructive">
          Codex sign-in is unavailable on this Host. A newly built Host needs a user-managed restart; otherwise check the official Codex client is installed.
        </p>
      ) : null}
      <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
        <Button disabled={begin.isPending || active} onClick={() => begin.mutate()}>
          {active ? 'Waiting for approval…' : 'Continue with Codex'}
        </Button>
        {active ? (
          <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            Cancel sign-in
          </Button>
        ) : null}
      </div>
    </section>
  )
}
