import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect } from 'react'
import { aiAccountsLoginApi } from './account-login-api.js'
import { useDeviceSignIn } from './device-sign-in.js'
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
  const operation = operationId === undefined ? {} : { operationId }
  const key =
    operationId === undefined ? (['ai-accounts', 'codex-login', instanceId] as const) : (['ai-accounts', 'codex-login', instanceId, operationId] as const)
  const { snapshot, send } = useDeviceSignIn({
    instanceId,
    ...(operationId !== undefined && { operationId }),
    ports: {
      begin: async () => {
        const next = await beginLoginQuery(client, key, () =>
          api.begin({ instanceId, ...operation, ...(props.replaceExisting === true && { replaceExisting: true }) }),
        )
        client.setQueryData(key, next)
        return next
      },
      cancel: async () => {
        await api.cancel({ instanceId, confirm: true, ...operation })
      },
      onConnected: () => onConnected(),
      onCancelled: () => {
        props.onCancelled?.()
        void client.invalidateQueries({ queryKey: key, exact: true })
      },
    },
  })
  const starting = snapshot.matches('starting')
  const status = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.status({ instanceId: instanceId }, { signal }),
    enabled: !starting,
    refetchInterval: query => (query.state.data?.status === 'starting' || query.state.data?.status === 'waiting' ? 1_000 : false),
    staleTime: 1_000,
    retry: false,
  })
  useEffect(() => {
    if (status.data === undefined) return
    send({ type: 'observed', status: status.data.status })
  }, [send, status.data])
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
        {status.data?.message ?? (starting ? 'Starting Codex sign-in…' : 'Ready to connect.')}
      </p>
      {status.isError || snapshot.context.failure !== null ? (
        <p role="alert" className="dshx:text-sm dshx:text-destructive">
          Codex sign-in is unavailable on this Host. A newly built Host needs a user-managed restart; otherwise check the official Codex client is installed.
        </p>
      ) : null}
      <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
        <Button disabled={starting || active} onClick={() => send({ type: 'begin' })}>
          {active ? 'Waiting for approval…' : 'Continue with Codex'}
        </Button>
        {active ? (
          <Button variant="outline" disabled={snapshot.matches('cancelling')} onClick={() => send({ type: 'cancel' })}>
            Cancel sign-in
          </Button>
        ) : null}
      </div>
    </section>
  )
}
