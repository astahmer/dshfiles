import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { CircleCheckIcon, CircleXIcon, PlayIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useApi } from '@dshfiles/dshx/client'
import { setupView, type SetupTaskView } from '@dshfiles/project-checks/workspace-setup'
import type { JjIntegrationTranslate } from './locales.js'
import { jjIntegrationApi } from './api.js'

export const workspaceSetupQueryKey = (sessionId: string, path: string) => ['jj-integration', 'workspace-setup', sessionId, path] as const

/** The live phase's glyph: a spinner while the dock is open, otherwise the finished state. */
const setupStatusIcon = (status: SetupTaskView['status'], open: boolean): JSX.Element => {
  if (open) return <Spinner className="dshx:size-3" />
  switch (status) {
    case 'succeeded':
      return <CircleCheckIcon className="dshx:size-3 dshx:text-emerald-500" aria-hidden />
    case 'cancelled':
      return <XIcon className="dshx:size-3 dshx:text-muted-foreground" aria-hidden />
    case 'queued':
      return <PlayIcon className="dshx:size-3 dshx:text-muted-foreground" aria-hidden />
    case 'failed':
    case 'timed-out':
    case 'blocked':
    case 'unknown':
    case 'running':
    case 'cancel-requested':
      return <CircleXIcon className="dshx:size-3 dshx:text-destructive" aria-hidden />
  }
}

/** The one-line state of one setup action: what the composer shows while the workspace is prepared. */
/** One phrase per live phase; the cancelled and cancel-requested phases share their wording on purpose. */
const setupStatusLine = (status: SetupTaskView['status'], t: JjIntegrationTranslate): string => {
  switch (status) {
    case 'queued':
      return t('setupQueued')
    case 'running':
    case 'cancel-requested':
      return t('setupRunning')
    case 'succeeded':
      return t('setupSucceeded')
    case 'cancelled':
      return t('setupCancelled')
    case 'failed':
    case 'timed-out':
    case 'blocked':
    case 'unknown':
      return t('setupFailed')
  }
}

export const setupTaskLine = (input: { readonly task: SetupTaskView; readonly t: JjIntegrationTranslate }): string => {
  const state = setupStatusLine(input.task.status, input.t)
  return `${input.t('setupTitle')} · ${input.task.label} · ${state}`
}

/**
 * The setup a project flagged for its new thread workspaces, above the composer: one row per trusted action with its
 * live phase, and a cancel control while it runs. Nothing renders when the project flagged none or this Session is not
 * in a thread workspace, so the composer looks exactly as it did before.
 */
export const WorkspaceSetupDock = (props: { readonly sessionId: string; readonly path: string | undefined; readonly t: JjIntegrationTranslate }) => {
  const api = useApi(jjIntegrationApi)
  const path = props.path
  const setup = useQuery({
    queryKey: workspaceSetupQueryKey(props.sessionId, path ?? ''),
    enabled: path !== undefined && path.length > 0,
    queryFn: async ({ signal }) =>
      runHostRequest({
        signal,
        timeoutMs: 30_000,
        request: hostSignal => api.workspaceSetup({ sessionId: props.sessionId, path: path ?? '' }, { signal: hostSignal }),
      }),
    // A dispatch is idempotent, so asking again while anything runs only reads the queue's current phase.
    refetchInterval: query => (query.state.data === undefined || setupView(query.state.data.tasks).open ? 1_500 : false),
  })
  const cancel = useMutation({
    mutationFn: async (taskId: string) =>
      runHostRequest({
        timeoutMs: 30_000,
        request: signal => api.cancelWorkspaceSetup({ sessionId: props.sessionId, taskId }, { signal }),
      }),
    onSuccess: () => void setup.refetch(),
  })
  const setupState = setup.data === undefined ? undefined : setupView(setup.data.tasks)
  if (setup.data === undefined || setupState === undefined || setup.data.tasks.length === 0) return null
  return (
    <div
      data-workspace-setup=""
      role="status"
      aria-label={props.t('setupTitle')}
      className="dshx-root dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-3xl dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted/40 dshx:px-2.5 dshx:py-2 dshx:text-xs"
    >
      {setup.data.tasks.map(task => {
        const open = setupState.open && (task.status === 'running' || task.status === 'queued' || task.status === 'cancel-requested')
        return (
          <div key={task.id} className="dshx:flex dshx:items-center dshx:gap-1.5">
            {setupStatusIcon(task.status, open)}
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate" title={task.label}>
              {setupTaskLine({ task, t: props.t })}
            </span>
            {open ? (
              <Button
                variant="ghost"
                size="sm"
                className="dshx:h-6 dshx:px-1.5 dshx:text-xs"
                disabled={cancel.isPending || task.status === 'cancel-requested'}
                onClick={() => cancel.mutate(task.id)}
              >
                {props.t('setupCancel')}
              </Button>
            ) : null}
          </div>
        )
      })}
      {setupState.failed ? <span className="dshx:text-xs dshx:text-destructive">{props.t('setupFailedHint')}</span> : null}
    </div>
  )
}
