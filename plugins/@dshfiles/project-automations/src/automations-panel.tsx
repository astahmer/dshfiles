import { useApi } from '@dshfiles/dshx/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { RoutineList, type Routine, type RoutineRunStatus } from '@dshfiles/plugin-ui/components/motion/routine-list'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { PageHeader } from '@dshfiles/plugin-ui/components/ui/page-header'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { useCopyFeedback } from '@dshfiles/plugin-ui/hooks/copy-feedback'
import { ClockIcon, FolderIcon, PencilIcon, PlusIcon, Trash2Icon, WebhookIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Schema } from 'effect'
import { useState } from 'react'
import { AutomationDialog, type ProjectChoice } from './automation-dialog.js'
import { AutomationFormModel, browserTimeZone, type AutomationForm } from './automation-form.js'
import { automationsApi, automationViewSchema, runRecordSchema, type AutomationView, type RunRecord } from './automations-api.js'

const keys = { all: ['project-automations'] as const, list: ['project-automations', 'list'] as const, runs: ['project-automations', 'runs'] as const }
const decodeViews = Schema.decodeUnknownSync(Schema.Struct({ automations: Schema.Array(automationViewSchema) }))
const decodeRuns = Schema.decodeUnknownSync(Schema.Struct({ runs: Schema.Array(runRecordSchema) }))
const decodeRun = Schema.decodeUnknownSync(runRecordSchema)
const HOST_DOWN = 'The automations Host plugin did not answer. Restart DSH after installing @dshfiles/project-automations, then retry.'

const when = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const RUN_STATUS = { started: 'ok', failed: 'failed', rejected: 'skipped' } as const satisfies Record<RunRecord['outcome'], RoutineRunStatus>

const outcomeVariant = (outcome: RunRecord['outcome']): 'default' | 'secondary' | 'destructive' =>
  outcome === 'started' ? 'default' : outcome === 'rejected' ? 'secondary' : 'destructive'

const CopyField = (props: { readonly label: string; readonly value: string; readonly multiline?: boolean }): JSX.Element => {
  const { copied, copy } = useCopyFeedback()
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2">
      <code
        aria-label={props.label}
        className={
          props.multiline === true
            ? 'dshx:min-w-0 dshx:flex-1 dshx:whitespace-pre-wrap dshx:break-all dshx:rounded-md dshx:bg-muted dshx:px-2 dshx:py-1.5 dshx:text-xs'
            : 'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:rounded-md dshx:bg-muted dshx:px-2 dshx:py-1.5 dshx:text-xs'
        }
      >
        {props.value}
      </code>
      <Button type="button" size="sm" variant="outline" className="dshx:shrink" aria-label={`Copy ${props.label}`} onClick={() => void copy(props.value)}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

const RunLine = (props: { readonly run: RunRecord; readonly showTitle: boolean; readonly openThread: (sessionId: string) => void }): JSX.Element => {
  const { run } = props
  return (
    <li className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:text-sm" data-run-outcome={run.outcome}>
      <Badge variant={outcomeVariant(run.outcome)}>{run.outcome}</Badge>
      <span className="dshx:text-muted-foreground">{when(run.startedAt)}</span>
      <span className="dshx:text-muted-foreground">· {run.trigger}</span>
      {props.showTitle ? <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">{run.automationTitle}</span> : null}
      {run.sessionId === undefined ? null : (
        <Button type="button" size="sm" variant="link" className="dshx:h-auto dshx:p-0" onClick={() => props.openThread(run.sessionId ?? '')}>
          Open thread
        </Button>
      )}
      {run.detail === undefined ? null : <span className="dshx:w-full dshx:text-xs dshx:text-muted-foreground">{run.detail}</span>}
    </li>
  )
}

/** One automation as a kit routine row: schedule, countdown, recent-run strip and switch, with its URL and last run below. */
const automationRoutine = (props: {
  readonly automation: AutomationView
  readonly runs: readonly RunRecord[]
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly openThread: (sessionId: string) => void
}): Routine => {
  const { automation } = props
  const url = automation.webhookUrl ?? (automation.webhookPath === null ? null : `${window.location.origin}${automation.webhookPath}`)
  const nextRunAt = automation.trigger.kind === 'schedule' && automation.trigger.nextRunAt !== null ? Date.parse(automation.trigger.nextRunAt) : Number.NaN
  const webhook = automation.trigger.kind === 'webhook'
  return {
    id: automation.id,
    name: automation.title,
    schedule: [webhook ? 'Webhook' : automation.schedule, automation.agentPreset, automation.model?.model].filter(part => part !== undefined).join(' · '),
    enabled: automation.enabled,
    ...(!Number.isNaN(nextRunAt) && { nextRunAt }),
    history: props.runs
      .filter(run => run.automationId === automation.id)
      .toReversed()
      .map(run => ({ id: run.id, status: RUN_STATUS[run.outcome], label: `${when(run.startedAt)} · ${run.trigger} · ${run.outcome}` })),
    sources: [webhook ? { label: 'Webhook', icon: WebhookIcon } : { label: 'Schedule', icon: ClockIcon }],
    destination: { label: automation.projectTitle ?? 'Project no longer registered', icon: FolderIcon },
    ...(automation.agentPreset !== undefined && { agent: { name: automation.agentPreset } }),
    busy: props.busy,
    runnable: true,
    actions: (
      <>
        <Button type="button" size="icon-xs" variant="ghost" disabled={props.busy} onClick={props.onEdit} aria-label={`Edit ${automation.title}`}>
          <PencilIcon />
        </Button>
        <Button type="button" size="icon-xs" variant="ghost" disabled={props.busy} onClick={props.onDelete} aria-label={`Delete ${automation.title}`}>
          <Trash2Icon />
        </Button>
      </>
    ),
    footer: (
      <>
        {url === null ? null : <CopyField label="Webhook URL" value={url} />}
        <ul className="dshx:m-0 dshx:min-w-0 dshx:list-none dshx:p-0">
          {automation.lastRun === null ? (
            <li className="dshx:text-sm dshx:text-muted-foreground">No run yet.</li>
          ) : (
            <RunLine run={automation.lastRun} showTitle={false} openThread={props.openThread} />
          )}
        </ul>
      </>
    ),
    details: (
      <div className="dshx:flex dshx:flex-col dshx:gap-2">
        <p className="dshx:m-0 dshx:whitespace-pre-wrap dshx:break-words">{automation.prompt}</p>
        {url === null ? null : (
          <>
            <p className="dshx:m-0">
              POST with x-dsh-timestamp (Unix seconds) and x-dsh-signature: sha256= HMAC-SHA256 of “timestamp.body” keyed with the value of{' '}
              {automation.trigger.kind === 'webhook' ? automation.trigger.secretRef : 'the secret'}. Requests more than 5 minutes off, replays and more than{' '}
              {automation.trigger.kind === 'webhook' ? automation.trigger.ratePerMinute : 10} per minute are refused.
            </p>
            <CopyField label="Signed test request" value={AutomationFormModel.curlExample(url)} multiline />
          </>
        )}
      </div>
    ),
  }
}

/** The Automations page: every project automation with its controls, then the latest runs of all of them. */
export const AutomationsPanel = (props: {
  readonly projects: () => readonly ProjectChoice[]
  readonly openThread: (sessionId: string) => void
}): JSX.Element => {
  const api = useApi(automationsApi)
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: keys.list,
    retry: false,
    refetchInterval: 15_000,
    queryFn: async ({ signal }) => decodeViews(await api.list({}, { signal })).automations,
  })
  const runs = useQuery({
    queryKey: keys.runs,
    retry: false,
    refetchInterval: 15_000,
    queryFn: async ({ signal }) => decodeRuns(await api.runs({ limit: 20 }, { signal })).runs,
  })
  const [dialog, setDialog] = useState<{ readonly id: string | undefined; readonly initial: AutomationForm } | null>(null)
  const [deleting, setDeleting] = useState<AutomationView | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.all })

  const save = useMutation({
    mutationFn: async (input: { readonly id: string | undefined; readonly form: AutomationForm }) =>
      api.save(AutomationFormModel.toDraft(input.form, input.id)),
    onSuccess: async () => {
      setDialog(null)
      await refresh()
    },
  })
  const toggle = useMutation({ mutationFn: async (input: { readonly id: string; readonly enabled: boolean }) => api.setEnabled(input), onSettled: refresh })
  const runNow = useMutation({ mutationFn: async (id: string) => decodeRun(await api.runNow({ id })), onSettled: refresh })
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete({ id, confirm: true }),
    onSuccess: () => setDeleting(null),
    onSettled: refresh,
  })
  const failure = toggle.error ?? runNow.error ?? remove.error
  const busy = toggle.isPending || runNow.isPending || remove.isPending
  const projects = props.projects()

  const openNew = () => {
    save.reset()
    setDialog({ id: undefined, initial: AutomationFormModel.empty({ projectId: projects[0]?.projectId ?? '', timeZone: browserTimeZone() }) })
  }

  return (
    <TooltipProvider>
      <main
        aria-label="Automations"
        className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-col dshx:gap-5 dshx:overflow-y-auto dshx:p-5 dshx:@max-pane-narrow:p-3"
      >
        <PageHeader heading="Automations" description="Schedules and signed webhooks that start a new thread in a project.">
          <Button type="button" size="sm" onClick={openNew}>
            <PlusIcon /> New automation
          </Button>
        </PageHeader>
        {list.isError ? (
          <div role="alert" className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
            <p className="dshx:m-0">{HOST_DOWN}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void list.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}
        {list.data?.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No automations yet</EmptyTitle>
              <EmptyDescription>Create one to start a thread on a schedule or when a signed webhook arrives, such as a failed CI run.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {list.data === undefined || list.data.length === 0 ? null : (
          <RoutineList
            aria-label="Automation list"
            heading={null}
            className="dshx:rounded-xl dshx:border dshx:border-border dshx:pt-3"
            routines={list.data.map(automation =>
              automationRoutine({
                automation,
                runs: runs.data ?? [],
                busy,
                openThread: props.openThread,
                onEdit: () => {
                  save.reset()
                  setDialog({ id: automation.id, initial: AutomationFormModel.of(automation, browserTimeZone()) })
                },
                onDelete: () => setDeleting(automation),
              }),
            )}
            onToggle={(id, enabled) => toggle.mutate({ id, enabled })}
            onRunNow={id => runNow.mutate(id)}
          />
        )}
        {failure === null ? null : (
          <p role="alert" className="dshx:m-0 dshx:text-sm dshx:text-destructive">
            {errorMessage(failure, HOST_DOWN)}
          </p>
        )}
        <section aria-label="Recent runs" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
          <h2 className="dshx:m-0 dshx:text-sm dshx:font-semibold">Recent runs</h2>
          {runs.data === undefined || runs.data.length === 0 ? (
            <p className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">No run yet. Use Run now to try an automation.</p>
          ) : (
            <ul className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-col dshx:gap-2 dshx:p-0">
              {runs.data.map(run => (
                <RunLine key={run.id} run={run} showTitle openThread={props.openThread} />
              ))}
            </ul>
          )}
        </section>
        {dialog === null ? null : (
          <AutomationDialog
            open
            editing={dialog.id !== undefined}
            initial={dialog.initial}
            projects={projects}
            pending={save.isPending}
            error={save.error === null ? null : errorMessage(save.error, HOST_DOWN)}
            onOpenChange={open => (open ? undefined : setDialog(null))}
            onSubmit={form => save.mutate({ id: dialog.id, form })}
          />
        )}
        <AlertDialog open={deleting !== null} onOpenChange={open => (open ? undefined : setDeleting(null))}>
          <AlertDialogContent className="dshx-root" size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
              <AlertDialogDescription>
                Its schedule or webhook URL stops and its run history is deleted. Threads it already started are kept. To stop it for a while instead, turn it
                off.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => (deleting === null ? undefined : remove.mutate(deleting.id))}>
                Delete automation
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </TooltipProvider>
  )
}
