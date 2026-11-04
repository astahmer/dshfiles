import { SessionId } from '@deepseek-ai/dsh-session/types'
import { useApi } from '@dshfiles/dshx/client'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { multiHostApi, multiHostKeys, multiHostQueries, type MultiHostClient, type RemoteThreadSummary } from '@dshfiles/multi-host/destination'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useMemo } from 'react'
import { ThreadViewModel, type ThreadStatusFilters, type ThreadSourceFilter } from './thread-view.js'
import { useQueries, useQuery } from '@dshfiles/plugin-ui/query'

type RemoteRuntimeStatus = Awaited<ReturnType<MultiHostClient['runtimeStatus']>>

export type RemoteSidebarThread = {
  readonly runtimeId: string
  readonly sessionId: string
  readonly title: string
  readonly cwd: string | undefined
  readonly hostName: string
  readonly connected: boolean
  readonly running: boolean
  readonly updatedAt: number
  readonly workspaceId: string | undefined
  readonly workspaceTitle: string | undefined
  readonly workspacePath?: string | undefined
}

const filterRemoteSidebarThreads = (input: {
  readonly threads: readonly RemoteSidebarThread[]
  readonly filters: ThreadStatusFilters
  readonly sourceFilter: ThreadSourceFilter
  readonly archivedSessionIds: ReadonlySet<string>
  readonly settledSessionIds: ReadonlySet<string>
  readonly mutedSessionIds: ReadonlySet<string>
}): readonly RemoteSidebarThread[] => {
  if (input.sourceFilter === 'subagents') return []
  return input.threads.filter(thread => {
    const sessionId = SessionId(thread.sessionId)
    return ThreadViewModel.matchesStatusFilter({
      filters: input.filters,
      running: thread.running,
      labels: [],
      unread: false,
      archived: input.archivedSessionIds.has(sessionId),
      settled: input.settledSessionIds.has(sessionId),
      muted: input.mutedSessionIds.has(sessionId),
    })
  })
}

type RemoteRuntimeStatusEntry = {
  readonly runtimeId: string
  readonly hostName: string
  readonly status: RemoteRuntimeStatus
}

const threadKey = (runtimeId: string, sessionId: string): string => `${runtimeId}\u0000${sessionId}`
const folderName = (path: string | undefined): string | undefined => path?.split(/[\\/]/u).filter(Boolean).at(-1)
const validTimestamp = (timestamp: number): number => (Number.isFinite(timestamp) ? timestamp : 0)
const createdTimestamp = (createdAt: string): number => validTimestamp(Date.parse(createdAt))
const originPathKey = (runtimeId: string, path: string): string => `${runtimeId}\u0000${path}`

const runtimesWithStartedThreads = <Runtime extends { readonly id: string }>(
  runtimes: readonly Runtime[],
  threads: readonly Pick<RemoteThreadSummary, 'runtimeId'>[],
): readonly Runtime[] => {
  const runtimeIds = new Set(threads.map(thread => thread.runtimeId))
  return runtimes.filter(runtime => runtimeIds.has(runtime.id))
}

/**
 * Project started-here remote threads, enriching their rows with live runtime details when available. Threads of a
 * hidden host stay stored but leave the sidebar, like the host leaves the destination picker.
 */
const buildRemoteSidebarThreads = (input: {
  readonly startedHere: readonly RemoteThreadSummary[]
  readonly statuses: readonly RemoteRuntimeStatusEntry[]
  readonly hiddenRuntimeIds?: ReadonlySet<string>
}): readonly RemoteSidebarThread[] => {
  const hidden = input.hiddenRuntimeIds ?? new Set<string>()
  const visibleStarted = input.startedHere.filter(thread => !hidden.has(thread.runtimeId))
  const startedHere = new Map(visibleStarted.map(thread => [threadKey(thread.runtimeId, thread.sessionId), thread]))
  const rows = new Map<string, RemoteSidebarThread>()
  const blank = new Set<string>()

  for (const entry of input.statuses) {
    if (!entry.status.ok || hidden.has(entry.runtimeId)) continue
    for (const session of entry.status.sessions) {
      const key = threadKey(session.runtimeId, session.sessionId)
      if (session.blank) {
        blank.add(key)
        continue
      }
      const started = startedHere.get(key)
      if (started === undefined) continue
      const cwd = session.cwd ?? started.cwd
      const workspace = entry.status.workspaces.find(candidate => candidate.sessionIds.includes(session.sessionId))
      const workspaceTitle = workspace?.title.trim() || folderName(cwd)
      const title = session.title?.trim() || started?.title.trim() || folderName(cwd) || session.sessionId
      rows.set(key, {
        runtimeId: session.runtimeId,
        sessionId: session.sessionId,
        title,
        cwd,
        hostName: entry.hostName,
        connected: entry.status.runtime.connected,
        running: session.running,
        updatedAt: validTimestamp(session.updatedAt),
        workspaceTitle,
        workspacePath: workspace?.path ?? cwd,
        workspaceId: workspaceTitle === undefined ? undefined : `remote-project:${entry.runtimeId}:${workspace?.workspaceId ?? workspaceTitle}`,
      })
    }
  }

  for (const thread of visibleStarted) {
    const key = threadKey(thread.runtimeId, thread.sessionId)
    if (rows.has(key) || blank.has(key)) continue
    const workspaceTitle = folderName(thread.cwd)
    rows.set(key, {
      runtimeId: thread.runtimeId,
      sessionId: thread.sessionId,
      title: thread.title.trim() || workspaceTitle || thread.sessionId,
      cwd: thread.cwd,
      hostName: thread.hostName,
      connected: thread.connected,
      running: false,
      updatedAt: createdTimestamp(thread.createdAt),
      workspaceTitle,
      workspacePath: thread.cwd,
      workspaceId: workspaceTitle === undefined ? undefined : `remote-project:${thread.runtimeId}:${workspaceTitle}`,
    })
  }

  return [...rows.values()].sort((left, right) => right.updatedAt - left.updatedAt)
}

/** Remote threads started here join the current view unless the user explicitly separates them. */
type LocalProject = { readonly workspaceId: string; readonly path: string }
type ProjectOriginsResult = Awaited<ReturnType<MultiHostClient['projectOrigins']>>
type ProjectOriginsInput = Parameters<MultiHostClient['projectOrigins']>[0]

const projectOriginsInputOf = (input: {
  readonly localProjects: readonly LocalProject[]
  readonly threads: readonly RemoteSidebarThread[]
}): ProjectOriginsInput => {
  const localPaths = [...new Set(input.localProjects.map(project => project.path))].sort().slice(0, 200)
  const pathsByRuntime = new Map<string, Set<string>>()
  for (const thread of input.threads) {
    if (thread.workspacePath === undefined) continue
    const paths = pathsByRuntime.get(thread.runtimeId) ?? new Set<string>()
    paths.add(thread.workspacePath)
    pathsByRuntime.set(thread.runtimeId, paths)
  }
  const remote = [...pathsByRuntime.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 64)
    .map(([runtimeId, paths]) => ({ runtimeId, paths: [...paths].sort().slice(0, 200) }))
  return { localPaths, remote }
}

const mapRemoteThreadsToLocalProjects = (input: {
  readonly threads: readonly RemoteSidebarThread[]
  readonly localProjects: readonly LocalProject[]
  readonly origins: ProjectOriginsResult['origins'] | undefined
}): readonly RemoteSidebarThread[] => {
  if (input.origins === undefined) return input.threads
  const projectsByPath = new Map(input.localProjects.map(project => [project.path, project]))
  const projectIdByOrigin = new Map<string, string>()
  const remoteOriginByPath = new Map<string, string>()

  for (const entry of input.origins) {
    if (entry.origin === null) continue
    if (entry.kind === 'local') {
      const project = projectsByPath.get(entry.path)
      if (project !== undefined && !projectIdByOrigin.has(entry.origin)) projectIdByOrigin.set(entry.origin, project.workspaceId)
      continue
    }
    if (entry.runtimeId !== undefined) remoteOriginByPath.set(originPathKey(entry.runtimeId, entry.path), entry.origin)
  }

  return input.threads.map(thread => {
    if (thread.workspacePath === undefined) return thread
    const origin = remoteOriginByPath.get(originPathKey(thread.runtimeId, thread.workspacePath))
    if (origin === undefined) return thread
    const workspaceId = projectIdByOrigin.get(origin)
    return workspaceId === undefined ? thread : { ...thread, workspaceId }
  })
}

export class RemoteThreadInventoryModel {
  static readonly filter = filterRemoteSidebarThreads
  static readonly build = buildRemoteSidebarThreads
  static readonly runtimesWithStartedThreads = runtimesWithStartedThreads
  static readonly projectOriginsInput = projectOriginsInputOf
  static readonly mapToLocalProjects = mapRemoteThreadsToLocalProjects
}

export const useRemoteSidebarThreads = (enabled: boolean, localProjects: readonly LocalProject[]): readonly RemoteSidebarThread[] => {
  const api = useApi(multiHostApi)
  const startedHere = useQuery({
    queryKey: multiHostKeys.threads,
    queryFn: ({ signal }) => api.threadList(undefined, { signal }),
    refetchInterval: query => (isApiOwnerMissing(query.state.error) ? false : 15_000),
    retry: false,
    enabled,
  })
  const directory = useQuery({ ...multiHostQueries.directory(api), enabled })
  const runtimes = useMemo(() => {
    const threads = startedHere.data?.threads
    if (!enabled || threads === undefined) return []
    return runtimesWithStartedThreads(directory.data?.runtimes ?? [], threads)
  }, [directory.data?.runtimes, enabled, startedHere.data?.threads])
  const statusQueries = useQueries({
    queries: runtimes.map(runtime => ({ ...multiHostQueries.status(api, runtime.id, 30_000), enabled })),
  })
  const statuses = useMemo(() => {
    if (!enabled) return []
    return statusQueries.flatMap((result, index) => {
      const runtime = runtimes[index]
      if (runtime === undefined || result.data === undefined) return []
      const hostName = directory.data?.hosts.find(host => host.id === runtime.hostId)?.name ?? runtime.name
      return [{ runtimeId: runtime.id, hostName, status: result.data }]
    })
  }, [directory.data?.hosts, enabled, runtimes, statusQueries])

  const hiddenRuntimeIds = useMemo(() => {
    const hiddenHosts = new Set((directory.data?.hosts ?? []).filter(host => host.hidden).map(host => host.id))
    return new Set((directory.data?.runtimes ?? []).filter(runtime => hiddenHosts.has(runtime.hostId)).map(runtime => runtime.id))
  }, [directory.data?.hosts, directory.data?.runtimes])
  const threads = useMemo(
    () => (enabled ? buildRemoteSidebarThreads({ startedHere: startedHere.data?.threads ?? [], statuses, hiddenRuntimeIds }) : []),
    [enabled, hiddenRuntimeIds, startedHere.data?.threads, statuses],
  )
  const originInput = useMemo(() => projectOriginsInputOf({ localProjects, threads }), [localProjects, threads])
  const origins = useQuery({
    queryKey: ['thread-sidebar', 'remote-project-origins', originInput],
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.projectOrigins(originInput, { signal: hostSignal }) }),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: enabled && originInput.localPaths.length > 0 && originInput.remote.length > 0,
  })

  return useMemo(
    () =>
      mapRemoteThreadsToLocalProjects({
        threads,
        localProjects,
        origins: origins.isError ? undefined : origins.data?.origins,
      }),
    [localProjects, origins.data?.origins, origins.isError, threads],
  )
}
