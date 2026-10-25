import { useApi } from '@dshfiles/dshx/client'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { multiHostApi, multiHostKeys, multiHostQueries, type MultiHostClient, type RemoteThreadSummary } from '@dshfiles/multi-host/destination'
import { useMemo } from 'react'
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

export const runtimesWithStartedThreads = <Runtime extends { readonly id: string }>(
  runtimes: readonly Runtime[],
  threads: readonly Pick<RemoteThreadSummary, 'runtimeId'>[],
): readonly Runtime[] => {
  const runtimeIds = new Set(threads.map(thread => thread.runtimeId))
  return runtimes.filter(runtime => runtimeIds.has(runtime.id))
}

/** Project started-here remote threads, enriching their rows with live runtime details when available. */
export const buildRemoteSidebarThreads = (input: {
  readonly startedHere: readonly RemoteThreadSummary[]
  readonly statuses: readonly RemoteRuntimeStatusEntry[]
}): readonly RemoteSidebarThread[] => {
  const startedHere = new Map(input.startedHere.map(thread => [threadKey(thread.runtimeId, thread.sessionId), thread]))
  const rows = new Map<string, RemoteSidebarThread>()

  for (const entry of input.statuses) {
    if (!entry.status.ok) continue
    for (const session of entry.status.sessions) {
      if (session.blank) continue
      const key = threadKey(session.runtimeId, session.sessionId)
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
        workspaceId: workspaceTitle === undefined ? undefined : `remote-project:${entry.runtimeId}:${workspace?.workspaceId ?? workspaceTitle}`,
      })
    }
  }

  for (const thread of input.startedHere) {
    const key = threadKey(thread.runtimeId, thread.sessionId)
    if (rows.has(key)) continue
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
      workspaceId: workspaceTitle === undefined ? undefined : `remote-project:${thread.runtimeId}:${workspaceTitle}`,
    })
  }

  return [...rows.values()].sort((left, right) => right.updatedAt - left.updatedAt)
}

/** Remote threads started here join the current view unless the user explicitly separates them. */
export const useRemoteSidebarThreads = (enabled: boolean): readonly RemoteSidebarThread[] => {
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

  return useMemo(
    () => (enabled ? buildRemoteSidebarThreads({ startedHere: startedHere.data?.threads ?? [], statuses }) : []),
    [enabled, startedHere.data?.threads, statuses],
  )
}
