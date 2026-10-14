import { useCallback, useMemo, useSyncExternalStore } from 'react'

/** The Host list stores, restated structurally so plugin-ui needs no session or workspace controller dependency. */
interface ListStore<Snapshot> {
  readonly list: {
    subscribe(listener: () => void): () => void
    getSnapshot(): Snapshot
  }
}

interface SessionEntry {
  readonly displayTitle?: string
  readonly cwd?: string | null
}

interface WorkspaceEntry {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
}

type SessionStore = ListStore<{ readonly byId: Readonly<Record<string, SessionEntry | undefined>> }>
type WorkspaceStore = ListStore<{ readonly items: readonly WorkspaceEntry[] }>

interface ProjectGroup<Item> {
  readonly project: Item | null
  readonly repositoryPath: string
  readonly threads: readonly Item[]
}

// jj-integration names thread workspaces `thread-<6 hex>` inside a `<repository>-threads` sibling directory.
const THREAD_WORKSPACE_NAME = /^thread-[0-9a-f]{6}$/u

const segments = (path: string): readonly string[] => path.replace(/\/+$/u, '').split('/')

const useListSnapshot = <Snapshot>(store: ListStore<Snapshot>): Snapshot => {
  const subscribe = useCallback((listener: () => void) => store.list.subscribe(listener), [store])
  const read = useCallback(() => store.list.getSnapshot(), [store])
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * Readable names for the opaque ids plugins receive: a Session id becomes its thread title, a workspace id or
 * path becomes its project name, and jj thread workspaces fold under the repository they were cut from.
 */
export class EntityLabels {
  static shortId(id: string): string {
    return id.replace(/^session-/u, '').slice(0, 8)
  }

  static isThreadWorkspace(path: string | null): boolean {
    return path !== null && THREAD_WORKSPACE_NAME.test(segments(path).at(-1) ?? '')
  }

  /** The repository checkout a thread workspace belongs to; the path itself for anything else. */
  static repositoryPath(path: string): string {
    if (!EntityLabels.isThreadWorkspace(path)) return path.replace(/\/+$/u, '')
    const parent = segments(path).slice(0, -1).join('/')
    return parent.endsWith('-threads') ? parent.slice(0, -'-threads'.length) : parent
  }

  /** Projects in their original order, each with the thread workspaces cut from it; orphan threads get a group with no project. */
  static groupByRepository<Item extends { readonly path: string | null }>(items: readonly Item[]): readonly ProjectGroup<Item>[] {
    const groups = new Map<string, { project: Item | null; threads: Item[] }>()
    for (const item of items) {
      if (item.path === null || EntityLabels.isThreadWorkspace(item.path)) continue
      groups.set(EntityLabels.repositoryPath(item.path), { project: item, threads: [] })
    }
    for (const item of items) {
      if (item.path === null || !EntityLabels.isThreadWorkspace(item.path)) continue
      const repositoryPath = EntityLabels.repositoryPath(item.path)
      const group = groups.get(repositoryPath) ?? { project: null, threads: [] }
      group.threads.push(item)
      groups.set(repositoryPath, group)
    }
    return [...groups.entries()].map(([repositoryPath, group]) => ({ repositoryPath, project: group.project, threads: group.threads }))
  }

  /** Resolves a Session id to its thread title, falling back to a short id for sessions this client does not list. */
  static useSessionLabel(sessions: SessionStore): (sessionId: string) => string {
    const snapshot = useListSnapshot(sessions)
    return useCallback(
      (sessionId: string) => {
        const title = snapshot.byId[sessionId]?.displayTitle?.trim()
        return title === undefined || title.length === 0 ? `Thread ${EntityLabels.shortId(sessionId)}` : title
      },
      [snapshot],
    )
  }

  /** The working directory the client knows for a Session, or null. */
  static useSessionCwd(sessions: SessionStore): (sessionId: string) => string | null {
    const snapshot = useListSnapshot(sessions)
    return useCallback((sessionId: string) => snapshot.byId[sessionId]?.cwd ?? null, [snapshot])
  }

  /**
   * Resolves a workspace id or a directory to its project name: a thread workspace reads as its repository's
   * project, and an unregistered directory as its folder name.
   */
  static useWorkspaceLabel(workspaces: WorkspaceStore): (target: { readonly workspaceId: string } | { readonly path: string }) => string {
    const items = useListSnapshot(workspaces).items
    const projectsByPath = useMemo(
      () => new Map(items.filter(item => !EntityLabels.isThreadWorkspace(item.path)).map(item => [item.path.replace(/\/+$/u, ''), item.title])),
      [items],
    )
    return useCallback(
      target => {
        const path = 'path' in target ? target.path : items.find(item => item.workspaceId === target.workspaceId)?.path
        if (path === undefined) return `Project ${EntityLabels.shortId('workspaceId' in target ? target.workspaceId : '')}`
        const repositoryPath = EntityLabels.repositoryPath(path)
        return projectsByPath.get(repositoryPath) ?? segments(repositoryPath).at(-1) ?? repositoryPath
      },
      [items, projectsByPath],
    )
  }
}
