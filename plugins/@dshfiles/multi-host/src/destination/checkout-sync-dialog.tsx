import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { CheckIcon, CopyIcon, FolderGit2Icon, RotateCwIcon, TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { Schema } from 'effect'
import { useState, type ReactNode } from 'react'
import type { HostSummary } from '../api.js'
import { CheckoutSyncView, recentCheckouts, type CheckoutSyncReport } from './checkout-sync-view.js'
import { multiHostKeys, type MultiHostClient } from './queries.js'

type Selection = { readonly path: string; readonly bookmark: string }
type Revision = CheckoutSyncReport['incoming']['revisions'][number]
type Workspace = CheckoutSyncReport['otherWorkspaces'][number]

const selectionFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    path: Schema.Trim.check(Schema.isPattern(/^\/.+/u, { message: 'Enter the absolute path of the checkout on this host.' })),
    bookmark: Schema.Trim.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u, { message: 'Enter a jj bookmark name, such as main.' })),
  }),
)

const shortId = (commit: string | undefined): string => commit?.slice(0, 12) ?? 'none'

const Section = (props: { readonly heading: string; readonly children: ReactNode }) => (
  <section className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
    <h3 className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{props.heading}</h3>
    {props.children}
  </section>
)

const RevisionList = (props: { readonly heading: string; readonly total: number; readonly revisions: readonly Revision[]; readonly localEdits?: boolean }) =>
  props.total === 0 ? null : (
    <Section heading={`${props.heading} · ${props.total}`}>
      <ul className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:text-sm" aria-label={props.heading}>
        {props.revisions.map(revision => (
          <li key={revision.commitId} className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2">
            <code className="dshx:shrink-0 dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{revision.changeId.slice(0, 8)}</code>
            <span className="dshx:min-w-0 dshx:truncate">{revision.description || 'No description'}</span>
            {props.localEdits === true && (revision.description === '' || revision.description.toLowerCase() === 'wip') ? (
              <Badge variant="secondary" className="dshx:shrink-0 dshx:text-[10px]">
                Local edits
              </Badge>
            ) : null}
            {revision.conflict ? (
              <Badge variant="outline" className="dshx:shrink-0 dshx:text-[10px]">
                Conflict
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
      {props.total > props.revisions.length ? (
        <p className="dshx:text-xs dshx:text-muted-foreground">{props.revisions.length} newest shown. Run jj log on the host for the rest.</p>
      ) : null}
    </Section>
  )

const WorkspaceRow = (props: { readonly workspace: Workspace; readonly current?: boolean }) => (
  <li className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-x-2 dshx:text-sm">
    <span className="dshx:font-medium">{props.workspace.name}</span>
    {props.current === true ? (
      <Badge variant="secondary" className="dshx:text-[10px]">
        This checkout
      </Badge>
    ) : null}
    {props.workspace.blocksSync ? (
      <Badge variant="outline" className="dshx:text-[10px]">
        Blocks this sync
      </Badge>
    ) : null}
    <code className="dshx:min-w-0 dshx:break-all dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{props.workspace.path ?? 'Path unknown'}</code>
    {props.workspace.threads.length === 0 ? null : (
      <span className="dshx:min-w-0 dshx:text-xs dshx:text-muted-foreground">
        Threads here: {props.workspace.threads.map(thread => thread.title).join(', ')}
      </span>
    )}
  </li>
)

const RecoveryStep = (props: { readonly label: string; readonly command?: string | undefined }) => {
  const [copied, setCopied] = useState<boolean | undefined>(undefined)
  const { command } = props
  const copy = async (text: string) => setCopied(await writeClipboard(text))
  return (
    <li className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:text-sm">
      <span>{props.label}</span>
      {command === undefined ? null : (
        <span className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-1">
          <code className="dshx:min-w-0 dshx:flex-1 dshx:rounded dshx:bg-muted dshx:px-2 dshx:py-1 dshx:font-mono dshx:text-xs dshx:break-all">{command}</code>
          <Button type="button" size="icon" variant="ghost" className="dshx:size-7" aria-label={`Copy command: ${command}`} onClick={() => void copy(command)}>
            {copied === true ? <CheckIcon className="dshx:size-3.5" /> : <CopyIcon className="dshx:size-3.5" />}
          </Button>
        </span>
      )}
      {copied === false ? <span className="dshx:text-xs dshx:text-destructive">Could not copy. Select the command and copy it by hand.</span> : null}
    </li>
  )
}

const BookmarkState = (props: { readonly report: CheckoutSyncReport }) => {
  const { bookmarkState: state } = props.report
  return (
    <Section heading={`Bookmark ${state.name}`}>
      <p className="dshx:text-sm">
        {state.conflicted ? (
          <>
            Conflicted between {state.local.map(shortId).join(' and ')}. Origin is at {shortId(state.origin)}.
          </>
        ) : (
          <>
            Here {shortId(state.local[0])} · origin {shortId(state.origin)}
            {state.origin !== undefined && !state.tracked ? ' · not tracked, so fetching does not move it here' : ''}
          </>
        )}
      </p>
    </Section>
  )
}

const Report = (props: { readonly report: CheckoutSyncReport }) => {
  const { report } = props
  const refused = !report.ok
  return (
    <div data-testid="checkout-sync-report" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
      <Alert variant={!refused ? 'default' : CheckoutSyncView.isRefusal(report) ? 'warning' : 'destructive'}>
        {refused ? <TriangleAlertIcon /> : <CheckIcon />}
        <AlertDescription data-testid="checkout-sync-status" data-status={report.status} className="dshx:text-left">
          {report.detail}
        </AlertDescription>
      </Alert>
      <RevisionList heading="Incoming from origin" total={report.incoming.total} revisions={report.incoming.revisions} />
      <RevisionList heading="Not pushed, in this working copy" total={report.outgoing.total} revisions={report.outgoing.revisions} localEdits />
      <RevisionList heading="Not pushed, on the local bookmark" total={report.unpushedBookmark.total} revisions={report.unpushedBookmark.revisions} />
      <RevisionList heading="Already on origin, will drop out" total={report.absorbed.length} revisions={report.absorbed} />
      {report.conflictFiles.length === 0 ? null : (
        <Section heading="Conflicting files">
          <ul className="dshx:font-mono dshx:text-xs" aria-label="Conflicting files">
            {report.conflictFiles.map(file => (
              <li key={file} className="dshx:break-all">
                {file}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {report.bookmarkState.origin === undefined && report.bookmarkState.local.length === 0 ? null : <BookmarkState report={report} />}
      {report.workspace === undefined && report.otherWorkspaces.length === 0 ? null : (
        <Section heading="Workspaces in this repository">
          <ul className="dshx:flex dshx:flex-col dshx:gap-1" aria-label="Workspaces in this repository">
            {report.workspace === undefined ? null : <WorkspaceRow workspace={report.workspace} current />}
            {report.otherWorkspaces.map(workspace => (
              <WorkspaceRow key={workspace.name} workspace={workspace} />
            ))}
          </ul>
        </Section>
      )}
      {report.recovery.length === 0 ? null : (
        <Section heading="What to do on this host">
          <ol className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Recovery steps">
            {report.recovery.map(step => (
              <RecoveryStep key={step.label} label={step.label} command={step.command} />
            ))}
          </ol>
        </Section>
      )}
    </div>
  )
}

const Body = (props: { readonly api: MultiHostClient; readonly host: HostSummary; readonly sshTarget: string; readonly onClose: () => void }) => {
  const { api, host, sshTarget } = props
  const [selection, setSelection] = useState<Selection | null>(null)
  const recent: Readonly<Record<string, readonly string[]>> = recentCheckouts.useValue()
  const threads = useQuery({ queryKey: multiHostKeys.threads, queryFn: ({ signal }) => api.threadList(undefined, { signal }) })
  const directory = useQuery({ queryKey: multiHostKeys.directory, queryFn: ({ signal }) => api.list(undefined, { signal }) })
  const runtimeIds = (directory.data?.runtimes ?? []).filter(runtime => runtime.hostId === host.id).map(runtime => runtime.id)
  const suggestions = CheckoutSyncView.suggestedCheckouts({
    recent: recent[sshTarget] ?? [],
    threadFolders: (threads.data?.threads ?? []).filter(thread => runtimeIds.includes(thread.runtimeId)).map(thread => thread.cwd),
  })
  const check = useQuery({
    queryKey: ['multi-host', 'checkout-sync', sshTarget, selection?.path, selection?.bookmark],
    enabled: selection !== null,
    queryFn: ({ signal }) => api.checkoutSync({ sshTarget, path: selection?.path ?? '', bookmark: selection?.bookmark ?? 'main', apply: false }, { signal }),
    gcTime: 0,
    retry: false,
  })
  const checked = CheckoutSyncView.reportOf(check.data)
  const sync = useMutation({
    mutationFn: (report: CheckoutSyncReport) =>
      api.checkoutSync({
        sshTarget,
        path: report.path,
        bookmark: report.bookmark,
        apply: true,
        expectedHead: report.head,
        expectedTarget: report.target,
      }),
  })
  const synced = CheckoutSyncView.reportOf(sync.data)
  const shown = synced.report ?? checked.report
  const problem =
    synced.problem ?? checked.problem ?? (check.isError ? errorMessage(check.error, 'The check failed. Check the host, then try again.') : undefined)
  const form = useAppForm({
    defaultValues: { path: '', bookmark: 'main' },
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: { onDynamic: selectionFormSchema },
    onSubmit: ({ value }) => {
      const next = { path: value.path.trim(), bookmark: value.bookmark.trim() }
      recentCheckouts.set(CheckoutSyncView.rememberCheckout({ recent, sshTarget, path: next.path }))
      sync.reset()
      if (selection?.path === next.path && selection.bookmark === next.bookmark) void check.refetch()
      else setSelection(next)
    },
  })
  const busy = check.isFetching || sync.isPending
  const canSync = sync.data === undefined && shown?.status === 'would-sync'
  return (
    <>
      <form
        className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3"
        onSubmit={event => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.AppField name="path">
          {field => <field.TextField label={`Checkout on ${host.name}`} monospace placeholder="/home/me/project" required />}
        </form.AppField>
        {suggestions.length === 0 ? null : (
          <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:gap-1" role="group" aria-label="Known checkouts">
            {suggestions.map(path => (
              <Button
                key={path}
                type="button"
                size="xs"
                variant="outline"
                className="dshx:max-w-full dshx:shrink dshx:font-mono!"
                onClick={() => form.setFieldValue('path', path)}
              >
                <span className="dshx:min-w-0 dshx:truncate">{path}</span>
              </Button>
            ))}
          </div>
        )}
        <form.AppField name="bookmark">{field => <field.TextField label="Bookmark to follow" monospace required />}</form.AppField>
        <Button type="submit" variant="outline" className="dshx:self-start" disabled={busy}>
          {check.isFetching ? <Spinner className="dshx:size-4" /> : <RotateCwIcon className="dshx:size-4" />}
          {selection === null ? 'Check' : 'Check again'}
        </Button>
      </form>
      <div aria-live="polite" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
        {check.isFetching ? <p className="dshx:text-sm dshx:text-muted-foreground">Fetching from origin and simulating the rebase on {host.name}…</p> : null}
        {sync.isPending ? <p className="dshx:text-sm dshx:text-muted-foreground">Rebasing on {host.name}…</p> : null}
        {problem === undefined ? null : (
          <Alert variant="destructive">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        {sync.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(sync.error, 'The sync did not finish. Check again to see the state of the checkout.')}</AlertDescription>
          </Alert>
        ) : null}
        {shown === undefined || check.isFetching ? null : <Report report={shown} />}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={props.onClose}>
          Close
        </Button>
        {canSync ? (
          <Button type="button" disabled={busy} onClick={() => sync.mutate(shown)}>
            {CheckoutSyncView.syncLabel(shown)}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}

/**
 * Compare one checkout on a host with its bookmark on origin, then bring it up to date. Sync fetches and rebases only:
 * it never pushes, and a refusal leaves the checkout as it was and says what to run on that host.
 */
export const CheckoutSyncDialog = (props: { readonly api: MultiHostClient; readonly host: HostSummary | undefined; readonly onClose: () => void }) => {
  const { host } = props
  const sshTarget = host?.connector.kind === 'ssh' ? host.connector.sshTarget : undefined
  return (
    <Dialog open={sshTarget !== undefined} onOpenChange={open => (open ? undefined : props.onClose())}>
      <DialogContent data-testid="checkout-sync-dialog" className="dshx-root dshx:max-h-[calc(100dvh-2rem)] dshx:overflow-y-auto dshx:sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:pr-6">
            <FolderGit2Icon className="dshx:size-4" />
            Sync checkout{host === undefined ? '' : ` · ${host.name}`}
          </DialogTitle>
          <DialogDescription>Compares a jj checkout with origin, then rebases it. Local edits come along. Nothing is ever pushed.</DialogDescription>
        </DialogHeader>
        {host === undefined || sshTarget === undefined ? null : (
          <Body key={host.id} api={props.api} host={host} sshTarget={sshTarget} onClose={props.onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}
