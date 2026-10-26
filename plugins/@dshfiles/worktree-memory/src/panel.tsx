import type { ISessions, SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  FolderGit2Icon,
  LayersIcon,
  LayoutGridIcon,
  MemoryStickIcon,
  RefreshCwIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { worktreeMemoryApi } from './api.js'
import type { WorktreeMemoryKey, WorktreeMemoryTranslate } from './locales.js'
import { bulkStoppable } from './stop-scope.js'
import {
  emptyCategoryBytes,
  processCategoryValues,
  type MemoryPressure,
  type ProcessCategory,
  type ProcessOrigin,
  type ProcessTree,
  type StopResult,
  type WorkspaceGroup,
} from './types.js'

const snapshotKey = ['worktree-memory', 'snapshot'] as const
const POLL_MS = 5_000
// The stop API refuses more than 200 targets, so a page-wide stop continues in batches until every listed tree is asked for.
const STOP_BATCH_SIZE = 200
// The sidebar badge is always mounted, so it polls far less often than the open panel; both share one cache entry.
const BADGE_POLL_MS = 30_000

const CATEGORY_KEY = {
  'dev-server': 'categoryDevServer',
  tests: 'categoryTests',
  build: 'categoryBuild',
  dsh: 'categoryDsh',
  services: 'categoryServices',
  other: 'categoryOther',
} as const satisfies Record<ProcessCategory, WorktreeMemoryKey>

const CATEGORY_COLOR = {
  'dev-server': 'dshx:bg-primary',
  tests: 'dshx:bg-chart-2',
  build: 'dshx:bg-chart-3',
  dsh: 'dshx:bg-chart-1',
  services: 'dshx:bg-chart-4',
  other: 'dshx:bg-chart-5',
} as const satisfies Record<ProcessCategory, string>

const PRESSURE = {
  normal: { key: 'pressureNormal', dot: 'dshx:bg-success' },
  warning: { key: 'pressureWarning', dot: 'dshx:bg-warning' },
  critical: { key: 'pressureCritical', dot: 'dshx:bg-destructive' },
  unknown: { key: 'pressureUnknown', dot: 'dshx:bg-muted-foreground' },
} as const satisfies Record<MemoryPressure, { readonly key: WorktreeMemoryKey; readonly dot: string }>

const ORIGIN_KEY = { job: 'originJob', host: 'originHost', detached: 'originDetached' } as const satisfies Record<ProcessOrigin, WorktreeMemoryKey>

const formatBytes = (bytes: number): string => {
  const gigabytes = bytes / 1024 ** 3
  if (gigabytes >= 1) return `${gigabytes.toFixed(1)} GB`
  return `${String(Math.max(0, Math.round(bytes / 1024 ** 2)))} MB`
}

const count = (value: number, one: WorktreeMemoryKey, many: WorktreeMemoryKey, t: WorktreeMemoryTranslate): string =>
  `${String(value)} ${t(value === 1 ? one : many)}`

const DETACHED_BADGE = 'dshx:shrink-0 dshx:border-destructive/40 dshx:text-destructive'
// Fusebox-style: the heaviest workspaces stay listed, the long tail folds behind one row.
const VISIBLE_GROUPS = 6

const formatAge = (since: number, now: number, t: WorktreeMemoryTranslate): string => {
  const minutes = Math.floor(Math.max(0, now - since) / 60_000)
  if (minutes < 1) return t('justNow')
  if (minutes < 60) return `${String(minutes)} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${String(hours)} h`
  return `${String(Math.floor(hours / 24))} d`
}

// One decimal of GB keeps the pill as narrow as the icon it sits on.
const formatDate = (at: number): string => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(at))

const compactGigabytes = (bytes: number): string => `${Math.max(0.1, bytes / 1024 ** 3).toFixed(1)}G`

/**
 * The RAM sidebar icon: a dot when the system is under memory pressure and a pill with the detached total, so a
 * leak is visible without opening the panel. A Host without this plugin's API stops the poll instead of retrying.
 */
export const MemoryGlyph = (props: { readonly size?: number; readonly t: WorktreeMemoryTranslate }): JSX.Element => {
  const api = useApi(worktreeMemoryApi)
  const snapshot = useQuery({
    queryKey: snapshotKey,
    queryFn: async ({ signal }) => api.snapshot({}, { signal }),
    refetchInterval: query => (isApiOwnerMissing(query.state.error) ? false : BADGE_POLL_MS),
    retry: false,
  })
  const pressure = snapshot.data?.pressure ?? 'unknown'
  const strained = pressure === 'warning' || pressure === 'critical'
  const detachedBytes = snapshot.data?.detachedBytes ?? 0
  const status = [strained ? props.t(PRESSURE[pressure].key) : null, detachedBytes > 0 ? `${formatBytes(detachedBytes)} ${props.t('detachedTotal')}` : null]
    .filter(part => part !== null)
    .join(' · ')
  const glyph = (
    <span className="dshx:relative dshx:inline-flex" data-memory-badge-pressure={pressure} data-memory-badge-detached-bytes={String(detachedBytes)}>
      <MemoryStickIcon aria-hidden size={props.size ?? 18} strokeWidth={1.7} />
      {strained ? (
        <span
          aria-hidden
          className={cn('dshx:absolute dshx:-top-0.5 dshx:-right-0.5 dshx:size-2 dshx:rounded-full dshx:ring-2 dshx:ring-background', PRESSURE[pressure].dot)}
        />
      ) : null}
      {detachedBytes > 0 ? (
        <span
          aria-hidden
          className="dshx:absolute dshx:-bottom-1.5 dshx:-left-0.5 dshx:rounded-sm dshx:bg-destructive dshx:px-0.5 dshx:text-[8px] dshx:leading-[10px] dshx:font-semibold dshx:text-white dshx:tabular-nums"
        >
          {compactGigabytes(detachedBytes)}
        </span>
      ) : null}
    </span>
  )
  if (status.length === 0) return glyph
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>{glyph}</TooltipTrigger>
        <TooltipContent>{status}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** The store's own branded identity for a Session the Host has listed, or undefined when it is not open. */
const sessionTarget = (sessions: ISessions, sessionId: string): SessionTarget | undefined =>
  Object.values(sessions.list.getSnapshot().byId).find(summary => summary?.id === sessionId)?.id

const CategoryBar = (props: {
  readonly bytes: Readonly<Record<ProcessCategory, number>>
  readonly total: number
  readonly className?: string
}): JSX.Element => (
  <div className={cn('dshx:flex dshx:h-1.5 dshx:w-full dshx:overflow-hidden dshx:rounded-full dshx:bg-muted', props.className)}>
    {processCategoryValues.map(category =>
      props.bytes[category] <= 0 || props.total <= 0 ? null : (
        <span key={category} className={CATEGORY_COLOR[category]} style={{ width: `${String((props.bytes[category] / props.total) * 100)}%` }} />
      ),
    )}
  </div>
)

const groupCategoryBytes = (group: WorkspaceGroup) => {
  const bytes = emptyCategoryBytes()
  for (const tree of group.trees) bytes[tree.category] += tree.bytes
  return bytes
}

const GroupIcon = (props: { readonly kind: WorkspaceGroup['kind'] }): JSX.Element => {
  const Icon = props.kind === 'project' ? FolderGit2Icon : props.kind === 'workspace' ? LayersIcon : CircleDashedIcon
  return <Icon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
}

interface StopControls {
  readonly armed: string | null
  readonly pending: boolean
  readonly arm: (key: string) => void
  readonly stop: (trees: readonly ProcessTree[]) => void
}

const StopButton = (props: {
  readonly armKey: string
  readonly trees: readonly ProcessTree[]
  readonly label: string
  readonly armedLabel?: string
  readonly subject: string
  readonly controls: StopControls
  readonly t: WorktreeMemoryTranslate
}): JSX.Element => {
  const armed = props.controls.armed === props.armKey
  const armedLabel = props.armedLabel ?? props.t('stopConfirm')
  return (
    <Button
      aria-label={`${armed ? armedLabel : props.label} ${props.subject}`}
      variant={armed ? 'destructive' : 'outline'}
      size="sm"
      className="dshx:shrink"
      disabled={props.controls.pending}
      onClick={() => (armed ? props.controls.stop(props.trees) : props.controls.arm(props.armKey))}
    >
      {armed ? armedLabel : props.label}
    </Button>
  )
}

const TreeRow = (props: {
  readonly tree: ProcessTree
  readonly now: number
  readonly threadLabel: (sessionId: string) => string
  readonly onOpenThread: (sessionId: string) => void
  readonly controls: StopControls
  readonly t: WorktreeMemoryTranslate
}): JSX.Element => {
  const tree = props.tree
  const origin = (
    <Badge variant="outline" className={tree.origin === 'detached' ? DETACHED_BADGE : 'dshx:shrink-0'}>
      {props.t(ORIGIN_KEY[tree.origin])}
    </Badge>
  )
  return (
    <li className="dshx:flex dshx:items-center dshx:gap-2 dshx:py-1.5" data-process-pid={tree.pid}>
      <span aria-hidden className={cn('dshx:size-2 dshx:shrink-0 dshx:rounded-sm', CATEGORY_COLOR[tree.category])} />
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
          <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{tree.name}</span>
          {tree.origin === 'detached' ? (
            <Tooltip>
              <TooltipTrigger asChild>{origin}</TooltipTrigger>
              <TooltipContent className="dshx:max-w-72">{props.t('originDetachedHint')}</TooltipContent>
            </Tooltip>
          ) : (
            origin
          )}
          {tree.sessionId === null ? null : (
            <TooltipProvider delayDuration={500}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:text-muted-foreground dshx:hover:text-foreground dshx:hover:underline dshx:@max-pane-narrow:hidden"
                    onClick={() => props.onOpenThread(tree.sessionId ?? '')}
                  >
                    {props.threadLabel(tree.sessionId)}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{props.t('openThread')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <TooltipProvider delayDuration={500}>
          <Tooltip>
            <TooltipTrigger asChild>
              <code className="dshx:min-w-0 dshx:truncate dshx:font-mono! dshx:text-xs dshx:text-muted-foreground">{tree.command}</code>
            </TooltipTrigger>
            <TooltipContent className="dshx:whitespace-pre-line">{`${tree.command}\n${tree.cwd}`}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="dshx:flex dshx:shrink-0 dshx:flex-col dshx:items-end">
        <span className="dshx:text-sm dshx:tabular-nums">{formatBytes(tree.bytes)}</span>
        <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">
          {formatAge(tree.startedAt, props.now, props.t)}
          {tree.processCount > 1 ? ` · ${count(tree.processCount, 'process', 'processes', props.t)}` : ''}
        </span>
      </div>
      <StopButton armKey={`tree:${String(tree.pid)}`} trees={[tree]} label={props.t('stop')} subject={tree.name} controls={props.controls} t={props.t} />
    </li>
  )
}

const GroupCard = (props: {
  readonly group: WorkspaceGroup
  readonly open: boolean
  readonly onToggle: () => void
  readonly now: number
  readonly threadLabel: (sessionId: string) => string
  readonly onOpenThread: (sessionId: string) => void
  readonly controls: StopControls
  readonly t: WorktreeMemoryTranslate
}): JSX.Element => {
  const { group, t } = props
  const Chevron = props.open ? ChevronDownIcon : ChevronRightIcon
  const running = group.threads.filter(thread => thread.running).length
  const latestThread = group.threads[0]
  const title = group.kind === 'elsewhere' ? t('elsewhere') : group.title
  const stoppable = bulkStoppable(group.trees)
  return (
    <section className={cn('dshx:flex dshx:flex-col dshx:rounded-lg', props.open && 'dshx:bg-muted/40')} data-workspace-group={group.key}>
      <div className="dshx:flex dshx:items-start dshx:gap-2 dshx:rounded-lg dshx:px-3 dshx:py-2 dshx:hover:bg-muted/60">
        <button
          type="button"
          className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-start dshx:gap-2 dshx:text-left"
          aria-expanded={props.open}
          onClick={props.onToggle}
        >
          <GroupIcon kind={group.kind} />
          <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
            <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
              <TooltipProvider delayDuration={500}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{title}</span>
                  </TooltipTrigger>
                  <TooltipContent className="dshx:max-w-96 dshx:break-all">{group.path}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {group.detachedCount === 0 ? null : (
                <Badge variant="outline" className={DETACHED_BADGE}>
                  {group.detachedCount} {t('detachedTotal')}
                </Badge>
              )}
              <span className="dshx:ml-auto dshx:shrink-0 dshx:text-sm dshx:font-medium dshx:tabular-nums">{formatBytes(group.bytes)}</span>
            </div>
            <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
              {[
                group.project,
                group.threadCount === 0
                  ? null
                  : `${count(group.threadCount, 'thread', 'threads', t)}${running === 0 ? '' : ` · ${String(running)} ${t('running')}`}`,
                count(group.trees.length, 'process', 'processes', t),
              ]
                .filter(part => part !== null)
                .join(' · ')}
            </span>
            {latestThread === undefined ? null : (
              <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">
                {latestThread.title ?? props.threadLabel(latestThread.sessionId)}
                {latestThread.createdAt == null ? '' : ` · ${t('created')} ${formatDate(latestThread.createdAt)}`}
                {latestThread.updatedAt === null ? '' : ` · ${t('updated')} ${formatAge(latestThread.updatedAt, props.now, t)} ${t('ago')}`}
              </span>
            )}
            <CategoryBar bytes={groupCategoryBytes(group)} total={group.bytes} className="dshx:max-w-80" />
          </div>
          <Chevron aria-hidden className="dshx:mt-0.5 dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
        </button>
        {stoppable.length === 0 ? null : (
          <StopButton
            armKey={`group-all:${group.key}`}
            trees={stoppable}
            label={t('stopAll', { count: stoppable.length })}
            armedLabel={t('stopConfirmCount', { count: stoppable.length })}
            subject={title}
            controls={props.controls}
            t={t}
          />
        )}
      </div>
      {props.open ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:px-3 dshx:pb-3 dshx:pl-9">
          {group.threads.length === 0 ? null : (
            <ul className="dshx:flex dshx:flex-col dshx:gap-0.5">
              {group.threads.map(thread => (
                <li key={thread.sessionId} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:text-xs">
                  <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                    <TooltipProvider delayDuration={500}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="dshx:min-w-0 dshx:truncate dshx:text-left dshx:hover:underline"
                            onClick={() => props.onOpenThread(thread.sessionId)}
                          >
                            {thread.title ?? props.threadLabel(thread.sessionId)}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t('openThread')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <span className="dshx:ml-auto dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:text-muted-foreground">
                      {thread.running ? (
                        <>
                          <Spinner aria-hidden className="dshx:size-3" /> {t('running')}
                        </>
                      ) : null}
                    </span>
                  </div>
                  {thread.createdAt == null && thread.updatedAt === null ? null : (
                    <div className="dshx:flex dshx:flex-wrap dshx:gap-x-3 dshx:text-[11px] dshx:text-muted-foreground">
                      {thread.createdAt == null ? null : (
                        <time dateTime={new Date(thread.createdAt).toISOString()}>
                          {t('created')} {formatDate(thread.createdAt)}
                        </time>
                      )}
                      {thread.updatedAt === null ? null : (
                        <time dateTime={new Date(thread.updatedAt).toISOString()}>
                          {t('updated')} {formatAge(thread.updatedAt, props.now, t)} {t('ago')}
                        </time>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ul className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
            {group.trees.map(tree => (
              <TreeRow
                key={tree.pid}
                tree={tree}
                now={props.now}
                threadLabel={props.threadLabel}
                onOpenThread={props.onOpenThread}
                controls={props.controls}
                t={t}
              />
            ))}
          </ul>
          {group.detachedCount < 2 ? null : (
            <div className="dshx:flex dshx:justify-end">
              <StopButton
                armKey={`group-detached:${group.key}`}
                trees={group.trees.filter(tree => tree.origin === 'detached')}
                label={`${t('stopDetached')} (${String(group.detachedCount)})`}
                subject={title}
                controls={props.controls}
                t={t}
              />
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

export interface WorktreeMemoryPanelProps {
  readonly sessions: ISessions
  readonly uiWorkspace: UiWorkspace
  readonly t: WorktreeMemoryTranslate
}

export function WorktreeMemoryPanel(props: WorktreeMemoryPanelProps): JSX.Element {
  const api = useApi(worktreeMemoryApi)
  const queryClient = useQueryClient()
  const t = props.t
  const [opened, setOpened] = useState<ReadonlySet<string> | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [stopOutcome, setStopOutcome] = useState<StopResult | null>(null)
  const [showAll, setShowAll] = useState(false)
  const sessionLabel = EntityLabels.useSessionLabel(props.sessions)

  const snapshot = useQuery({
    queryKey: snapshotKey,
    queryFn: async ({ signal }) => api.snapshot({}, { signal }),
    refetchInterval: POLL_MS,
  })

  const stop = useMutation({
    mutationFn: async (trees: readonly ProcessTree[]) => {
      const total: StopResult = { stopped: 0, viaJob: 0, missing: 0, refused: 0 }
      for (let index = 0; index < trees.length; index += STOP_BATCH_SIZE) {
        const result = await api.stop({
          targets: trees.slice(index, index + STOP_BATCH_SIZE).map(tree => ({ pid: tree.pid, startedAt: tree.startedAt })),
          confirm: true,
        })
        total.stopped += result.stopped
        total.viaJob += result.viaJob
        total.missing += result.missing
        total.refused += result.refused
      }
      return total
    },
    onSuccess: result => {
      setArmed(null)
      setStopOutcome(result)
      void queryClient.invalidateQueries({ queryKey: snapshotKey })
    },
  })

  const controls: StopControls = {
    armed,
    pending: stop.isPending,
    arm: key => {
      setArmed(key)
      setStopOutcome(null)
    },
    stop: trees => stop.mutate(trees),
  }
  const openThread = (sessionId: string): void => {
    const target = sessionTarget(props.sessions, sessionId)
    if (target !== undefined) props.uiWorkspace.openSession(target)
  }

  const value = snapshot.data
  const now = value?.takenAt ?? 0
  const groups = value?.groups ?? []
  const openKeys = opened ?? new Set(groups.slice(0, 1).map(group => group.key))
  const toggle = (key: string): void =>
    setOpened(() => {
      const next = new Set(openKeys)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const detached = groups.flatMap(group => group.trees.filter(tree => tree.origin === 'detached'))
  const listedTrees = groups.flatMap(group => group.trees)
  const stoppableTrees = bulkStoppable(listedTrees)
  const leftRunning = listedTrees.length - stoppableTrees.length
  const pressure = PRESSURE[value?.pressure ?? 'unknown']

  return (
    <div className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:overflow-hidden">
      <div
        className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-3 dshx:overflow-y-auto dshx:p-5 dshx:@max-pane-narrow:p-3"
        data-memory-scroll-region
      >
        <header className="dshx:flex dshx:flex-col dshx:gap-2">
          <div className="dshx:flex dshx:items-center dshx:gap-2">
            <MemoryStickIcon aria-hidden className="dshx:size-5 dshx:shrink-0 dshx:text-muted-foreground" />
            <h1 className="dshx:text-xl dshx:font-semibold">{t('title')}</h1>
            <Badge variant="secondary" className="dshx:shrink-0" data-memory-pressure={value?.pressure ?? 'unknown'}>
              <span aria-hidden className={cn('dshx:size-1.5 dshx:rounded-full', pressure.dot)} />
              {t(pressure.key)}
            </Badge>
            <span className="dshx:ml-auto dshx:text-lg dshx:font-semibold dshx:tabular-nums">
              {value === undefined ? '—' : formatBytes(value.trackedBytes)}
            </span>
            <Button variant="ghost" size="icon" aria-label={t('refresh')} disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}>
              {snapshot.isFetching ? <Spinner aria-hidden /> : <RefreshCwIcon aria-hidden />}
            </Button>
          </div>
          <p className="dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{t('subtitle')}</p>
          {value === undefined ? null : (
            <>
              <CategoryBar bytes={value.categoryBytes} total={value.trackedBytes} />
              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground">
                {processCategoryValues.map(category =>
                  value.categoryBytes[category] <= 0 ? null : (
                    <span key={category} className="dshx:flex dshx:items-center dshx:gap-1">
                      <span aria-hidden className={cn('dshx:size-2 dshx:rounded-sm', CATEGORY_COLOR[category])} />
                      {t(CATEGORY_KEY[category])} <span className="dshx:tabular-nums">{formatBytes(value.categoryBytes[category])}</span>
                    </span>
                  ),
                )}
                <span className="dshx:ml-auto dshx:tabular-nums">
                  {t('thisHost')} {formatBytes(value.hostBytes)} · {formatBytes(value.systemBytes)} {t('ofRam')}
                </span>
              </div>
            </>
          )}
        </header>

        {snapshot.isPending ? (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
            <Spinner aria-hidden /> {t('loading')}
          </p>
        ) : null}
        {snapshot.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(snapshot.error, t('loadFailed'))}</AlertDescription>
          </Alert>
        ) : null}
        {value !== undefined && !value.supported ? (
          <Alert>
            <AlertDescription>{t('unsupported')}</AlertDescription>
          </Alert>
        ) : null}
        {stop.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(stop.error, t('stopFailed'))}</AlertDescription>
          </Alert>
        ) : null}
        {stopOutcome === null ? null : (
          <p className="dshx:text-xs dshx:text-muted-foreground" role="status">
            {t('stopSummary')} {stopOutcome.stopped + stopOutcome.viaJob}
            {stopOutcome.refused === 0 ? '' : ` · ${String(stopOutcome.refused)} ${t('stopRefused')}`}
            {stopOutcome.missing === 0 ? '' : ` · ${String(stopOutcome.missing)} ${t('stopMissing')}`}
          </p>
        )}
        {value !== undefined && value.supported && groups.length === 0 ? <p className="dshx:text-sm dshx:text-muted-foreground">{t('noProcesses')}</p> : null}

        <div className="dshx:flex dshx:flex-col dshx:gap-1">
          {(showAll ? groups : groups.slice(0, VISIBLE_GROUPS)).map(group => (
            <GroupCard
              key={group.key}
              group={group}
              open={openKeys.has(group.key)}
              onToggle={() => toggle(group.key)}
              now={now}
              threadLabel={sessionLabel}
              onOpenThread={openThread}
              controls={controls}
              t={t}
            />
          ))}
          {groups.length <= VISIBLE_GROUPS ? null : (
            <button
              type="button"
              className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:px-3 dshx:py-2 dshx:text-left dshx:text-sm dshx:text-muted-foreground dshx:hover:bg-muted/60"
              aria-expanded={showAll}
              onClick={() => setShowAll(current => !current)}
            >
              <LayoutGridIcon aria-hidden className="dshx:size-4 dshx:shrink-0" />
              {showAll ? (
                t('showLess')
              ) : (
                <>
                  <span className="dshx:min-w-0 dshx:truncate">
                    {groups.length - VISIBLE_GROUPS} {t('showSmaller')} ·{' '}
                    {groups
                      .slice(VISIBLE_GROUPS)
                      .map(group => (group.kind === 'elsewhere' ? t('elsewhere') : group.title))
                      .join(', ')}
                  </span>
                  <span className="dshx:ml-auto dshx:shrink-0 dshx:tabular-nums">
                    {formatBytes(groups.slice(VISIBLE_GROUPS).reduce((sum, group) => sum + group.bytes, 0))}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {value === undefined || listedTrees.length === 0 ? null : (
        <footer className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:border-t dshx:border-border dshx:bg-background dshx:px-5 dshx:py-2 dshx:@max-pane-narrow:px-3">
          <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:text-muted-foreground">
            {count(listedTrees.length, 'process', 'processes', t)} · <span className="dshx:tabular-nums">{formatBytes(value.trackedBytes)}</span>
            {value.detachedCount === 0 ? '' : ` · ${String(value.detachedCount)} ${t('detachedTotal')}`}
            {leftRunning === 0 ? '' : ` · ${t('leftRunning', { count: leftRunning })}`}
          </span>
          <span className="dshx:ml-auto" />
          {detached.length < 2 ? null : (
            <StopButton
              armKey="all-detached"
              trees={detached}
              label={`${t('stopDetached')} (${String(detached.length)})`}
              subject={formatBytes(value.detachedBytes)}
              controls={controls}
              t={t}
            />
          )}
          {stoppableTrees.length === 0 ? null : (
            <StopButton
              armKey="all-everything"
              trees={stoppableTrees}
              label={t('stopEverything', { count: stoppableTrees.length })}
              armedLabel={t('stopConfirmCount', { count: stoppableTrees.length })}
              subject={formatBytes(value.trackedBytes)}
              controls={controls}
              t={t}
            />
          )}
        </footer>
      )}
    </div>
  )
}
