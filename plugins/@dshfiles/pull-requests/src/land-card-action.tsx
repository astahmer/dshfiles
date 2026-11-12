import type { LandCardActionProps } from '@dshfiles/diffs-review/land-card-actions'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ExternalLinkIcon, GitPullRequestIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { PluginQueryProvider, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { PullRequestSnapshot } from './pull-request-model.js'

/** The pull-request fields the card reads from `list`. */
export interface LandCardPullRequest {
  readonly repo: string
  readonly number: number
  readonly url: string
  readonly lastKnownState: PullRequestSnapshot | null
}

export interface LandCardActionPorts {
  readonly list: (sessionId: string, signal: AbortSignal) => Promise<readonly LandCardPullRequest[]>
  /** Opens the existing create dialog (preview, then confirm) for the thread. */
  readonly openCreate: (target: { readonly sessionId: string; readonly title: string }) => void
  /** Whether the create dialog is open, so the card re-reads links once it closes. */
  readonly dialogOpen: { readonly subscribe: (listener: () => void) => () => void; readonly get: () => boolean }
}

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const RUNNING = new Set(['PENDING', 'QUEUED', 'IN_PROGRESS', 'UNKNOWN', 'STALE'])

/** "3 checks passed", "1 of 4 checks failed", "2 of 3 checks running", or undefined with no checks yet. */
export const describeChecks = (checks: readonly { readonly status: string }[]): { readonly text: string; readonly failed: boolean } | undefined => {
  if (checks.length === 0) return undefined
  const failed = checks.filter(check => !PASSED.has(check.status) && !RUNNING.has(check.status)).length
  const running = checks.filter(check => RUNNING.has(check.status)).length
  const of = (count: number): string => (count === checks.length ? String(count) : `${String(count)} of ${String(checks.length)}`)
  if (failed > 0) return { text: `${of(failed)} check${failed === 1 && checks.length === 1 ? '' : 's'} failed`, failed: true }
  if (running > 0) return { text: `${of(running)} check${checks.length === 1 ? '' : 's'} running`, failed: false }
  return { text: `${String(checks.length)} check${checks.length === 1 ? '' : 's'} passed`, failed: false }
}

const stateLabel = (state: PullRequestSnapshot['state'] | undefined): string => {
  if (state === 'MERGED') return 'merged'
  if (state === 'CLOSED') return 'closed'
  if (state === 'OPEN') return 'open'
  return 'state unknown'
}

const PullRequestStatus = (props: { readonly link: LandCardPullRequest }): JSX.Element => {
  const snapshot = props.link.lastKnownState
  const checks = snapshot === null ? undefined : describeChecks(snapshot.checks)
  return (
    <a
      className="dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:px-2 dshx:py-1 dshx:text-xs dshx:hover:bg-accent"
      data-testid="land-card-pull-request"
      href={props.link.url}
      rel="noreferrer"
      target="_blank"
    >
      <GitPullRequestIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
      <span className="dshx:shrink-0 dshx:font-medium">#{props.link.number}</span>
      <span className="dshx:shrink-0 dshx:text-muted-foreground">{stateLabel(snapshot?.state)}</span>
      {checks === undefined ? null : (
        <span className={cn('dshx:min-w-0 dshx:truncate', checks.failed ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}>· {checks.text}</span>
      )}
      <ExternalLinkIcon aria-hidden className="dshx:size-3 dshx:shrink-0 dshx:text-muted-foreground" />
    </a>
  )
}

const OpenPullRequest = (props: LandCardActionProps & { readonly ports: LandCardActionPorts }): JSX.Element | null => {
  const links = useQuery({
    queryKey: ['pull-requests', 'land-card', props.sessionId],
    refetchInterval: 30_000,
    retry: false,
    queryFn: ({ signal }) => props.ports.list(props.sessionId, signal),
  })
  const dialogOpen = useSyncExternalStore(props.ports.dialogOpen.subscribe, props.ports.dialogOpen.get, () => false)
  const wasOpen = useRef(dialogOpen)
  useEffect(() => {
    if (wasOpen.current && !dialogOpen) void links.refetch()
    wasOpen.current = dialogOpen
  }, [dialogOpen, links])
  const open = links.data?.find(link => link.lastKnownState?.state !== 'CLOSED')
  if (open !== undefined) return <PullRequestStatus link={open} />
  if (props.unlanded === 0) return null
  return (
    <Button
      data-testid="land-card-open-pr"
      disabled={dialogOpen}
      onClick={() => props.ports.openCreate({ sessionId: props.sessionId, title: props.threadTitle ?? 'this thread' })}
      size="sm"
      type="button"
      variant="outline"
    >
      {links.isPending || dialogOpen ? <Spinner /> : <GitPullRequestIcon aria-hidden className="dshx:size-3.5" />}
      Open PR
    </Button>
  )
}

/**
 * **Open PR** beside Land on diffs-review's Land card (E4). It opens the same preview-then-confirm dialog as the palette
 * verb, so publishing always shows base, bookmark, title and body first and the GitHub CLI's sign-in problems arrive
 * with their recovery. Once a pull request is linked to the thread the card shows its state and CI checks instead,
 * read from the links this plugin already watches.
 */
export const createLandCardAction =
  (ports: LandCardActionPorts) =>
  (props: LandCardActionProps): JSX.Element => (
    <PluginQueryProvider>
      <OpenPullRequest {...props} ports={ports} />
    </PluginQueryProvider>
  )
