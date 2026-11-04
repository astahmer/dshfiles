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
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@dshfiles/plugin-ui/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { PageHeader } from '@dshfiles/plugin-ui/components/ui/page-header'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { useCopyFeedback } from '@dshfiles/plugin-ui/hooks/copy-feedback'
import { PlayIcon, PencilIcon, PlusIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
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

const AutomationRow = (props: {
  readonly automation: AutomationView
  readonly busy: boolean
  readonly onToggle: (enabled: boolean) => void
  readonly onRunNow: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly openThread: (sessionId: string) => void
}): JSX.Element => {
  const { automation } = props
  const url = automation.webhookUrl ?? (automation.webhookPath === null ? null : `${window.location.origin}${automation.webhookPath}`)
  const next = automation.trigger.kind === 'schedule' ? automation.trigger.nextRunAt : null
  return (
    <li
      aria-label={automation.title}
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-border dshx:p-4"
      data-automation-id={automation.id}
    >
      <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:justify-between dshx:gap-3">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
          <h3 className="dshx:m-0 dshx:truncate dshx:text-base dshx:font-semibold">{automation.title}</h3>
          <p className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
            {automation.projectTitle ?? 'Project no longer registered'} · {automation.trigger.kind === 'webhook' ? 'Webhook' : automation.schedule}
            {automation.agentPreset === undefined ? '' : ` · ${automation.agentPreset}`}
            {automation.model === undefined ? '' : ` · ${automation.model.model}`}
          </p>
          {automation.trigger.kind === 'schedule' ? (
            <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">{automation.enabled ? `Next run ${when(next)}` : 'Paused: no run is planned.'}</p>
          ) : null}
        </div>
        <Switch
          aria-label={`Enabled: ${automation.title}`}
          checked={automation.enabled}
          disabled={props.busy}
          onCheckedChange={checked => props.onToggle(checked)}
        />
      </div>
      {url === null ? null : (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
          <CopyField label="Webhook URL" value={url} />
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" size="sm" variant="link" className="dshx:h-auto dshx:self-start dshx:p-0">
                How to sign a request
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="dshx:mt-2 dshx:flex dshx:flex-col dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
              <p className="dshx:m-0">
                POST with x-dsh-timestamp (Unix seconds) and x-dsh-signature: sha256= HMAC-SHA256 of “timestamp.body” keyed with the value of{' '}
                {automation.trigger.kind === 'webhook' ? automation.trigger.secretRef : 'the secret'}. Requests more than 5 minutes off, replays and more than{' '}
                {automation.trigger.kind === 'webhook' ? automation.trigger.ratePerMinute : 10} per minute are refused.
              </p>
              <CopyField label="Signed test request" value={AutomationFormModel.curlExample(url)} multiline />
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
        <ul className="dshx:m-0 dshx:min-w-0 dshx:flex-1 dshx:list-none dshx:p-0">
          {automation.lastRun === null ? (
            <li className="dshx:text-sm dshx:text-muted-foreground">No run yet.</li>
          ) : (
            <RunLine run={automation.lastRun} showTitle={false} openThread={props.openThread} />
          )}
        </ul>
        <div className="dshx:flex dshx:shrink-0 dshx:gap-2">
          <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={props.onRunNow}>
            <PlayIcon /> Run now
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={props.onEdit} aria-label={`Edit ${automation.title}`}>
            <PencilIcon /> <span className="dshx:@max-pane-narrow:sr-only">Edit</span>
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={props.onDelete} aria-label={`Delete ${automation.title}`}>
            <Trash2Icon /> <span className="dshx:@max-pane-narrow:sr-only">Delete</span>
          </Button>
        </div>
      </div>
    </li>
  )
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
        <ul aria-label="Automation list" className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-col dshx:gap-3 dshx:p-0">
          {list.data.map(automation => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              busy={busy}
              openThread={props.openThread}
              onToggle={enabled => toggle.mutate({ id: automation.id, enabled })}
              onRunNow={() => runNow.mutate(automation.id)}
              onEdit={() => {
                save.reset()
                setDialog({ id: automation.id, initial: AutomationFormModel.of(automation, browserTimeZone()) })
              }}
              onDelete={() => setDeleting(automation)}
            />
          ))}
        </ul>
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
  )
}
