import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { jjIntegrationApi, type ThreadView } from '@dshfiles/jj-integration/api'
import { jujutsuApi } from './api.js'
import { jujutsuQueryKeys } from './repository-query-cache.js'

const workspacesKey = (repoRoot: string) => ['jujutsu', repoRoot, 'workspace-removal', 'workspaces'] as const
const threadKey = (repoRoot: string, name: string) => ['jujutsu', repoRoot, 'workspace-removal', 'thread', name] as const
const forgetPreviewKey = (repoRoot: string, name: string) => ['jujutsu', repoRoot, 'workspace-removal', 'forget', name] as const

const removalLabel = (name: string, thread: ThreadView | null): string =>
  thread !== null && thread.unlanded.length > 0
    ? `Remove ${name} and abandon ${String(thread.unlanded.length)} revision(s)?`
    : thread === null
      ? `Remove workspace ${name}?`
      : `Remove ${name} and its folder?`

const removalDescription = (thread: ThreadView | null): string =>
  thread === null
    ? 'Forgets the workspace registration in this repository. Its folder, its files and every commit stay on disk.'
    : thread.unlanded.length > 0
      ? 'Forgets the jj workspace, removes any DSH project entry, deletes its folder and abandons the revisions listed below. Conversations remain in DSH and are not archived.'
      : 'Forgets the jj workspace, removes any DSH project entry and deletes its folder. Conversations remain in DSH and are not archived.'

const confirmLabel = (thread: ThreadView | null): string =>
  thread === null ? 'Remove workspace' : thread.unlanded.length > 0 ? 'Abandon work and remove workspace' : 'Remove workspace and folder'

/**
 * The revision row's inline confirmation for one workspace: a managed thread workspace is discarded whole through
 * jj-integration, any other workspace is only unregistered through a prepared `workspace-forget` mutation.
 */
export const InlineWorkspaceRemoval = (props: {
  readonly repoId: string
  readonly repoRoot: string
  readonly name: string
  readonly onCancel: () => void
  readonly onRemoved: () => void
}): JSX.Element => {
  const jj = useApi(jjIntegrationApi)
  const jujutsu = useApi(jujutsuApi)
  const queryClient = useQueryClient()
  const workspaces = useQuery({
    queryKey: workspacesKey(props.repoRoot),
    queryFn: ({ signal }) => jujutsu.workspaces({ repoId: props.repoId }, { signal }),
    retry: false,
  })
  const path = workspaces.data?.workspaces.find(workspace => workspace.name === props.name)?.path
  const threadQuery = useQuery({
    queryKey: threadKey(props.repoRoot, props.name),
    enabled: path !== undefined,
    queryFn: ({ signal }) => jj.threadAt({ path: path ?? '' }, { signal }),
    retry: false,
  })
  const thread = threadQuery.data?.thread ?? null
  const missing = workspaces.data !== undefined && path === undefined
  const forget = useQuery({
    queryKey: forgetPreviewKey(props.repoRoot, props.name),
    enabled: threadQuery.data !== undefined && thread === null,
    queryFn: ({ signal }) => jujutsu.prepare({ repoId: props.repoId, action: { kind: 'workspace-forget', name: props.name } }, { signal }),
    retry: false,
  })
  const removal = useMutation({
    mutationFn: async () => {
      if (thread !== null) {
        const outcome = await runHostRequest({
          timeoutMs: 120_000,
          request: signal => jj.discard({ path: thread.path, force: thread.unlanded.length > 0 }, { signal }),
        })
        return { status: outcome.status === 'discarded' ? ('removed' as const) : ('has-work' as const) }
      }
      if (forget.data === undefined) throw new Error('The workspace preview is still loading.')
      const previewId = forget.data.id
      await runHostRequest({
        timeoutMs: 120_000,
        request: signal => jujutsu.confirm({ repoId: props.repoId, previewId }, { signal }),
      })
      return { status: 'removed' as const }
    },
    onSuccess: result => {
      if (result.status === 'has-work') {
        void queryClient.invalidateQueries({ queryKey: threadKey(props.repoRoot, props.name) })
        return
      }
      queryClient.removeQueries({ queryKey: forgetPreviewKey(props.repoRoot, props.name) })
      void queryClient.invalidateQueries({ queryKey: jujutsuQueryKeys.repository(props.repoRoot) })
      props.onRemoved()
    },
  })
  const loading = workspaces.data === undefined || (threadQuery.data === undefined && !missing) || (thread === null && !missing && forget.data === undefined)
  const lookupError =
    workspaces.isError || threadQuery.isError
      ? errorMessage(workspaces.error ?? threadQuery.error, 'Could not look up this workspace.')
      : missing
        ? 'This workspace is no longer present. Refresh the graph.'
        : null
  const previewError = forget.isError ? errorMessage(forget.error, 'This workspace cannot be removed.') : null
  const failure = removal.isError ? errorMessage(removal.error, 'The workspace could not be removed.') : null
  const refused = removal.data?.status === 'has-work'
  const problem = lookupError ?? previewError ?? failure

  return (
    <section
      aria-label={`Confirm removing workspace ${props.name}`}
      className="dshx-root dshx:mt-2 dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-destructive/40 dshx:bg-destructive/5 dshx:p-3"
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        props.onCancel()
      }}
      role="group"
    >
      <p className="dshx:text-xs dshx:font-medium" role="status">
        {removalLabel(props.name, thread)}
      </p>
      <p className="dshx:text-xs dshx:text-muted-foreground">
        {removalDescription(thread)}
        {loading && <span className="dshx:ml-1">Looking up this workspace…</span>}
      </p>
      {thread === null ? null : (
        <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs">
          <span className="dshx:font-mono dshx:break-all dshx:text-muted-foreground">{thread.path}</span>
          {thread.unlanded.length === 0 ? (
            <span className="dshx:text-muted-foreground">No unlanded revisions.</span>
          ) : (
            <ul
              aria-label="Revisions to abandon"
              className="dshx:flex dshx:max-h-40 dshx:flex-col dshx:gap-1 dshx:overflow-y-auto dshx:rounded-sm dshx:bg-muted dshx:p-2"
            >
              {thread.unlanded.map(revision => (
                <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2" key={revision.commitId}>
                  <span className="dshx:flex-none dshx:font-mono dshx:text-muted-foreground">{revision.changeId.slice(0, 8)}</span>
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{revision.description.split('\n')[0] || '(no description)'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {thread === null && forget.data !== undefined && (
        <pre className="dshx:max-h-40 dshx:overflow-auto dshx:rounded-sm dshx:bg-muted dshx:p-2 dshx:font-mono! dshx:text-[11px] dshx:whitespace-pre-wrap">
          {forget.data.detail}
        </pre>
      )}
      {refused && (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          This workspace gained revisions to rebase since you opened this preview. Refresh to see them before removal.
        </p>
      )}
      {problem !== null && (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          {problem}
        </p>
      )}
      <div className="dshx:flex dshx:justify-end dshx:gap-2">
        <Button disabled={removal.isPending} onClick={props.onCancel} size="sm" type="button" variant="outline">
          Cancel
        </Button>
        <Button
          autoFocus
          disabled={loading || removal.isPending || problem !== null || refused}
          onClick={() => removal.mutate()}
          size="sm"
          type="button"
          variant="destructive"
        >
          {removal.isPending && <Spinner className="dshx:size-3" />}
          {confirmLabel(thread)}
        </Button>
      </div>
    </section>
  )
}
