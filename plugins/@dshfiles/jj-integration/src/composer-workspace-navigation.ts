import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'

export type ComposerReferenceHandoff = Pick<InputState, 'draft' | 'occurrences'>

// The native picker starts a blank Session in the destination; in a fresh checkout of a large repository with no spare
// waiting for that branch, that first Session can take well past 15 seconds.
const ARRIVAL_TIMEOUT_MS = 120_000

export const arrivalTimeoutMessage = (workspaceId: string): string =>
  `DSH did not open the new thread in ${workspaceId} within ${String(Math.round(ARRIVAL_TIMEOUT_MS / 1000))} seconds. Pick that workspace again, or reload the page if it stays unreachable.`

const referencesTimeoutMessage = (workspaceId: string): string =>
  `The new thread opened in ${workspaceId}, but its draft's references did not come back within ${String(Math.round(ARRIVAL_TIMEOUT_MS / 1000))} seconds. Add them again in the composer.`

export const createComposerWorkspaceNavigation = (input: {
  readonly selectedWorkspace: () => string | undefined
  readonly subscribe: (listener: () => void) => () => void
  readonly captureReferences: () => ComposerReferenceHandoff | undefined
  readonly restoreReferences: (input: {
    readonly workspaceId: string
    readonly handoff: ComposerReferenceHandoff
    readonly signal: AbortSignal
  }) => Promise<void>
  /**
   * The composer's local drafts by Session, with the Workspace each one belongs to. The native picker creates a fresh
   * draft in the target Workspace, so one that was not there before the pick is the arrival itself — even while the
   * Session list does not report that blank draft yet, which is what `selectedWorkspace` alone cannot observe.
   */
  readonly composerDrafts: () => Readonly<Record<string, string | undefined>>
}) => {
  let pick: ((workspaceId: string) => void) | undefined

  const bind = (nextPick: (workspaceId: string) => void): (() => void) => {
    pick = nextPick
    return () => {
      if (pick === nextPick) pick = undefined
    }
  }

  const pickWorkspace = (workspaceId: string): boolean => {
    if (pick === undefined) return false
    pick(workspaceId)
    return true
  }

  const open = (workspaceId: string, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted()
    if (input.selectedWorkspace() === workspaceId) return Promise.resolve()
    const handoff = input.captureReferences()
    const draftsBeforeThePick = new Set(Object.keys(input.composerDrafts()))
    const arrived = (): boolean => {
      if (input.selectedWorkspace() === workspaceId) return true
      return Object.entries(input.composerDrafts()).some(
        ([sessionId, workspaceIdOfDraft]) => workspaceIdOfDraft === workspaceId && !draftsBeforeThePick.has(sessionId),
      )
    }
    // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot the initiating composer; navigation remounts and replaces its binding.
    const select = pick
    if (select === undefined) return Promise.reject(new Error('The new-thread composer is no longer mounted.'))
    const lifetime = AbortSignal.any([signal, AbortSignal.timeout(ARRIVAL_TIMEOUT_MS)])
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        unsubscribe()
        lifetime.removeEventListener('abort', abort)
      }
      const abort = () => {
        cleanup()
        // Only the switch itself asked for this abort; an arrival that never came needs a message with a next step.
        reject(signal.aborted ? (signal.reason ?? new Error('Opening that workspace was cancelled.')) : new Error(arrivalTimeoutMessage(workspaceId)))
      }
      let resolving = false
      const changed = () => {
        if (!arrived() || resolving) return
        resolving = true
        cleanup()
        if (handoff === undefined) {
          resolve()
          return
        }
        try {
          // The restore rejects with its signal's reason; a timeout's own reason reads only "signal timed out".
          void input
            .restoreReferences({ workspaceId, handoff, signal: lifetime })
            .then(resolve, (error: unknown) =>
              reject(
                !signal.aborted && error instanceof DOMException && error.name === 'TimeoutError' ? new Error(referencesTimeoutMessage(workspaceId)) : error,
              ),
            )
        } catch (error) {
          reject(error)
        }
      }
      const unsubscribe = input.subscribe(changed)
      lifetime.addEventListener('abort', abort, { once: true })
      try {
        // The native picker owns draft/attachment transfer and clearing the source before navigation.
        select(workspaceId)
        changed()
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }

  return { bind, open, pickWorkspace }
}
