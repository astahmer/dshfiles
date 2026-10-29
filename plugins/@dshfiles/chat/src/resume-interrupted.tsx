import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { PluginQueryProvider, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { interruptionApi } from '@dshfiles/session-controller/interruption-api'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'

interface ResumeInterruptedProps {
  readonly sessionId: string
  readonly seq: number
}

export const resumeAvailabilityRefetchInterval = (available: boolean | undefined): number | false => (available === true ? 30_000 : false)

export const ResumeInterrupted = (props: ResumeInterruptedProps) => (
  <PluginQueryProvider>
    <ResumeAction key={`${props.sessionId}:${props.seq}`} {...props} />
  </PluginQueryProvider>
)

const ResumeAction = (props: ResumeInterruptedProps) => {
  const api = useApi(interruptionApi)
  return <ResumeInterruptedAction {...props} api={api} />
}

export const ResumeInterruptedAction = (
  props: ResumeInterruptedProps & {
    readonly api: Pick<ReturnType<typeof useApi<typeof interruptionApi.methods>>, 'available' | 'resume' | 'retry'>
  },
) => {
  const api = props.api
  const queryClient = useQueryClient()
  const queryKey = ['chat', 'resume-interrupted', props.sessionId, props.seq]
  const available = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.available({ sessionId: props.sessionId, seq: props.seq }, { signal }),
    refetchInterval: query => (isApiOwnerMissing(query.state.error) ? false : resumeAvailabilityRefetchInterval(query.state.data?.available)),
    retry: false,
  })
  // A Host older than the retry verb reports no action and keeps resuming.
  const retrying = available.data?.action === 'retry'
  const resume = useMutation({
    mutationFn: () => (retrying ? api.retry : api.resume)({ sessionId: props.sessionId, seq: props.seq }),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, { available: false })
    },
  })
  if (available.data?.available !== true) return null
  const label = retrying
    ? { idle: 'Retry', pending: 'Retrying…', failed: 'Could not retry. Try again.' }
    : { idle: 'Resume', pending: 'Resuming…', failed: 'Could not resume. Try again.' }
  return (
    <span className="dshx-root dshx:flex dshx:flex-col dshx:gap-1">
      <Button size="sm" disabled={resume.isPending} onClick={() => resume.mutate()}>
        {resume.isPending ? label.pending : label.idle}
      </Button>
      {resume.isError && (
        <span role="alert" className="dshx:text-destructive dshx:text-xs">
          {label.failed}
        </span>
      )}
    </span>
  )
}
