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

// jj-integration cuts a thread workspace at `<repository>-threads/<name>`; older ones are `<repository>-<hash>`.
const THREADS_DIRECTORY_SUFFIX = '-threads'
const THREAD_WORKSPACE_NAME = /^thread-[0-9a-f]{6}$/u

const segments = (path: string): readonly string[] => path.replace(/\/+$/u, '').split('/')

const hasThreadsDirectory = (name: string | undefined): boolean =>
  name !== undefined && name.length > THREADS_DIRECTORY_SUFFIX.length && name.endsWith(THREADS_DIRECTORY_SUFFIX)

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

  /** A jj workspace a project was cut from: it belongs to that project and is never a project of its own. */
  static isThreadWorkspace(path: string | null): boolean {
    if (path === null) return false
    const parts = segments(path)
    return THREAD_WORKSPACE_NAME.test(parts.at(-1) ?? '') || hasThreadsDirectory(parts.at(-2))
  }

  /** The repository checkout a thread workspace belongs to; the path itself for anything else. */
  static repositoryPath(path: string): string {
    if (!EntityLabels.isThreadWorkspace(path)) return path.replace(/\/+$/u, '')
    const parent = segments(path).slice(0, -1).join('/')
    return parent.endsWith(THREADS_DIRECTORY_SUFFIX) ? parent.slice(0, -THREADS_DIRECTORY_SUFFIX.length) : parent
  }

  /**
   * Registered rows that are projects: a jj workspace cut from one is a workspace of it, so a project list, a project
   * filter or a project chooser leaves those out and shows the checkout they belong to instead.
   */
  static projectsOf<Item extends { readonly path: string }>(items: readonly Item[]): readonly Item[] {
    return items.filter(item => !EntityLabels.isThreadWorkspace(item.path))
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
