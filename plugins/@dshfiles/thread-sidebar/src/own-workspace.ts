import type { ThreadSidebarTranslate } from './thread-view-manager.js'
import { type ThreadDirectories, WorkspacePaths, workspaceName } from './workspace-paths.js'

/** What a row reads of a jj thread workspace from jj-integration's inventory. */
export interface OwnWorkspaceThread {
  readonly path: string
  readonly unlanded: readonly unknown[]
  readonly behindCount?: number | undefined
  readonly behind?: boolean | undefined
  readonly rebasedAt?: number | undefined
}

export type OwnWorkspaceStateKind = 'to-land' | 'landed' | 'behind'

export interface OwnWorkspaceState {
  readonly kind: OwnWorkspaceStateKind
  readonly text: string
  /** When it landed, for the landed word's tooltip. */
  readonly at?: number | undefined
}

/** A thread's own jj workspace as its row shows it: never by name, which only the tooltip and the copy action carry. */
export interface OwnWorkspace {
  readonly name: string
  readonly path: string | undefined
  readonly state: OwnWorkspaceState | undefined
}

/**
 * A thread workspace is a detail of its thread (b:212a). A row says only whether the thread has one and, at most, one
 * short state word: what is left to land first, then that it landed, then how far it fell behind.
 */
export class OwnWorkspaceModel {
  static stateOf(input: {
    readonly thread: OwnWorkspaceThread | undefined
    readonly rebasedAt: number | undefined
    readonly t: ThreadSidebarTranslate
  }): OwnWorkspaceState | undefined {
    const unlanded = input.thread?.unlanded.length ?? 0
    if (unlanded > 0) return { kind: 'to-land', text: input.t('threadSidebarWorkspaceToLand', { count: unlanded }) }
    const landedAt = input.rebasedAt ?? input.thread?.rebasedAt
    if (landedAt !== undefined) return { kind: 'landed', text: input.t('threadSidebarWorkspaceLanded'), at: landedAt }
    const behind = input.thread?.behindCount ?? (input.thread?.behind === true ? 1 : 0)
    if (behind > 0) return { kind: 'behind', text: input.t('threadSidebarWorkspaceBehind', { count: behind }) }
    return undefined
  }

  /**
   * The row's own-workspace view, or undefined for a thread in the project checkout. The registered thread workspace
   * wins; a Session whose registration is gone (landed and cleaned up) still names its folder under `<project>-threads`.
   */
  static of(input: {
    readonly registered: string | undefined
    readonly cwd: string | undefined
    readonly thread: OwnWorkspaceThread | undefined
    readonly rebasedAt: number | undefined
    readonly t: ThreadSidebarTranslate
    /** Where providers put thread workspaces (upstream opmospso), so a custom threads directory is recognised too. */
    readonly threadDirectories?: ThreadDirectories | undefined
  }): OwnWorkspace | undefined {
    const path =
      input.registered ??
      input.thread?.path ??
      (input.cwd !== undefined && input.cwd !== '' && WorkspacePaths.isJjWorkspace({ path: input.cwd, threadDirectories: input.threadDirectories })
        ? input.cwd
        : undefined)
    if (path === undefined) return undefined
    const name = workspaceName(path)
    if (name === undefined) return undefined
    return { name, path, state: OwnWorkspaceModel.stateOf(input) }
  }
}
