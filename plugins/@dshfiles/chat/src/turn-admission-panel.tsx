import { useApi, useResource } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'
import { turnAdmissionApi, type TurnAdmissionPolicy } from '@dshfiles/session-controller/turn-admission-api'
import { TURN_ADMISSION_READ } from './turn-admission-read.ts'

const SNAPSHOT_KEY = ['session-controller', 'turn-admission'] as const

const useAdmissionSnapshot = () => {
  const api = useApi(turnAdmissionApi)
  return useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.snapshot({}, { signal: hostSignal }) }),
    retry: false,
  })
}

/** Settings › General: how many threads may run at once, and whether subagents take a slot. */
export const TurnAdmissionSettingsRow = (): JSX.Element | null => {
  const api = useApi(turnAdmissionApi)
  const queryClient = useQueryClient()
  const snapshot = useAdmissionSnapshot()
  const saved = snapshot.data?.policy
  const [limit, setLimit] = useState('')
  useEffect(() => {
    if (saved !== undefined) setLimit(String(saved.maxRunningThreads))
  }, [saved])
  const save = useMutation({
    mutationFn: (policy: TurnAdmissionPolicy) => api.configure(policy),
    onSuccess: next => queryClient.setQueryData(SNAPSHOT_KEY, next),
  })
  // An older Host without the limit hides the row instead of offering a control that cannot save.
  if (saved === undefined) return null
  const commitLimit = (): void => {
    const parsed = Number(limit)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 64) {
      setLimit(String(saved.maxRunningThreads))
      return
    }
    if (parsed !== saved.maxRunningThreads) save.mutate({ ...saved, maxRunningThreads: parsed })
  }
  return (
    <div
      className="dshx-root dshx:flex dshx:flex-col dshx:gap-3 dshx:border-b-[0.5px] dshx:border-border dshx:py-4"
      data-settings-entry="running-threads-limit"
    >
      <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-6">
        <label htmlFor="dshfiles-running-threads-limit" className="dshx:min-w-0">
          <span className="dshx:block dshx:text-[14px] dshx:leading-5">Running threads limit</span>
          <span className="dshx:mt-1 dshx:block dshx:text-[12px] dshx:leading-[18px] dshx:text-muted-foreground">
            New turns wait for a free slot once this many threads run. 0 means no limit.
          </span>
        </label>
        <Input
          id="dshfiles-running-threads-limit"
          type="number"
          inputMode="numeric"
          min={0}
          max={64}
          className="dshx:h-11 dshx:w-20 dshx:shrink-0"
          value={limit}
          disabled={save.isPending}
          onChange={event => setLimit(event.currentTarget.value)}
          onBlur={commitLimit}
          onKeyDown={event => {
            if (event.key === 'Enter') commitLimit()
          }}
        />
      </div>
      <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-6">
        <label htmlFor="dshfiles-running-threads-subagents" className="dshx:min-w-0 dshx:text-[13px]">
          Subagents take a slot
        </label>
        <Switch
          id="dshfiles-running-threads-subagents"
          checked={saved.countSubagents}
          disabled={save.isPending}
          onCheckedChange={checked => save.mutate({ ...saved, countSubagents: checked })}
        />
      </div>
      {save.isError ? (
        <p role="alert" className="dshx:text-xs dshx:text-destructive">
          {errorMessage(save.error, 'The limit could not be saved.')} Change it again to retry.
        </p>
      ) : null}
    </div>
  )
}

/** Above the composer: this thread's turn waits for a free slot, with how many start first and a way past the limit. */
export const TurnAdmissionDock = (props: { readonly sessionId: string }): JSX.Element | null => {
  const api = useApi(turnAdmissionApi)
  const snapshot = useResource(turnAdmissionApi, 'snapshot', {}, TURN_ADMISSION_READ)
  const data = snapshot.status === 'error' ? undefined : snapshot.data
  const waiting = data?.waiting.find(held => held.sessionId === props.sessionId)
  const refetch = snapshot.refetch
  const start = useMutation({
    mutationFn: () => api.forceStart({ sessionId: props.sessionId }),
    onSettled: () => refetch(),
  })
  if (waiting === undefined || data === undefined) return null
  return (
    <div
      role="status"
      data-turn-admission-waiting=""
      className="dshx-root dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted/40 dshx:px-3 dshx:py-1.5 dshx:text-xs"
    >
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">
        Waiting for a free slot · {waiting.ahead} ahead · {data.running}/{data.policy.maxRunningThreads} running
      </span>
      <Button size="sm" variant="outline" className="dshx:min-h-11 dshx:shrink-0" disabled={start.isPending} onClick={() => start.mutate()}>
        Start now
      </Button>
      {start.isError ? (
        <span role="alert" className="dshx:text-destructive">
          {errorMessage(start.error, 'Could not start.')}
        </span>
      ) : null}
    </div>
  )
}
