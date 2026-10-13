import { basename, dirname, join } from 'node:path'
import type { JjExecutor } from './jj.js'
import type { ExistingBinding } from './thread-provision.js'
import { provisionThreadWorkspace } from './thread-provision.js'

/**
 * The awaited workspace-resolution boundary: the Host asks this service for the
 * directory a Session must own before the Agent exists, so the first tool call
 * already runs inside the provisioned workspace.
 *
 * The service name and result shape are the generic contract the Host consumes;
 * nothing here is jj-specific from the Host's point of view. This module is the
 * jj-specific implementation of it.
 */

export type WorkspaceIsolationMode = 'auto' | 'manual' | 'off'

export interface SessionWorkspaceResolutionRequest {
  readonly sessionId: string
  readonly requestedCwd: string
}

export type SessionWorkspaceResolution =
  | { readonly kind: 'resolved'; readonly cwd: string }
  | { readonly kind: 'passthrough' }
  | { readonly kind: 'refused'; readonly reason: string }

export interface SessionWorkspaceResolver {
  resolve(request: SessionWorkspaceResolutionRequest): Promise<SessionWorkspaceResolution>
}

export interface ThreadIsolationOptions {
  /** Read per resolution, so a settings change applies to the next Session and never to a running one. */
  readonly mode: () => WorkspaceIsolationMode
  readonly executor: JjExecutor
  /** Bookmark or commit id every new thread workspace is based on. */
  readonly spineRevision: string
  /** Parent directory for thread workspaces; defaults to a sibling of the repository root. */
  readonly workspacesDirectory?: string | undefined
  readonly findBinding: (sessionId: string) => Promise<ExistingBinding | undefined>
  readonly rememberBinding: (input: {
    readonly sessionId: string
    readonly workspaceName: string
    readonly path: string
    readonly baseCommitId: string | null
  }) => Promise<void>
  /**
   * Register a freshly provisioned directory with DSH's own workspace registry.
   *
   * The native attachment contract keys a workspace's visible sessions by exact
   * path equality, so an isolated directory that is not a registered workspace
   * cannot own its Session: it would be created and then be undiscoverable.
   * Registration is what keeps discovery, resume and restart working while the
   * execution directory stays isolated.
   */
  readonly registerWorkspace?: ((input: { readonly path: string; readonly sessionId: string }) => Promise<void>) | undefined
}

export const threadWorkspacesDirectory = (repositoryRoot: string): string =>
  join(dirname(repositoryRoot), `${basename(repositoryRoot)}-threads`)

/**
 * Resolve the directory a new Session must own.
 *
 * `off` and `manual` never provision: a disabled feature is an explicit choice,
 * not a fallback after failure. `auto` provisions an independent workspace or
 * refuses — it never returns the shared checkout as a consolation prize, so a
 * provisioning failure can never silently behave like `off`.
 */
export const createThreadWorkspaceResolver = (options: ThreadIsolationOptions): SessionWorkspaceResolver => ({
  resolve: async (request) => {
    const mode = options.mode()
    if (mode === 'off') return { kind: 'passthrough' }

    const binding = await options.findBinding(request.sessionId)
    if (binding !== undefined) return { kind: 'resolved', cwd: binding.path }
    if (mode === 'manual') return { kind: 'passthrough' }

    const outcome = await provisionThreadWorkspace({
      executor: options.executor,
      repoRoot: request.requestedCwd,
      workspacesDirectory: options.workspacesDirectory ?? threadWorkspacesDirectory(request.requestedCwd),
      threadName: basename(request.requestedCwd),
      sessionId: request.sessionId,
      spineRevision: options.spineRevision,
    })
    if (outcome.status === 'not-a-jj-repository') return { kind: 'passthrough' }
    if (outcome.path === null) {
      return { kind: 'refused', reason: `${outcome.status}: ${outcome.reason ?? 'no workspace path was produced'}` }
    }
    await options.rememberBinding({
      sessionId: request.sessionId,
      workspaceName: outcome.workspaceName,
      path: outcome.path,
      baseCommitId: outcome.baseCommitId,
    })
    // Best effort: a registry that cannot take the directory must not fail
    // provisioning, but a failure is reported so it is never silent.
    await options.registerWorkspace?.({ path: outcome.path, sessionId: request.sessionId }).catch(() => undefined)
    return { kind: 'resolved', cwd: outcome.path }
  },
})
