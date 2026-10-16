import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'

export type ComposerReferenceHandoff = Pick<InputState, 'draft' | 'occurrences'>

export const createComposerWorkspaceNavigation = (input: {
  readonly selectedWorkspace: () => string | undefined
  readonly subscribe: (listener: () => void) => () => void
  readonly captureReferences: () => ComposerReferenceHandoff | undefined
  readonly restoreReferences: (input: {
    readonly workspaceId: string
    readonly handoff: ComposerReferenceHandoff
    readonly signal: AbortSignal
  }) => Promise<void>
}) => {
  let pick: ((workspaceId: string) => void) | undefined

  const bind = (nextPick: (workspaceId: string) => void): (() => void) => {
    pick = nextPick
    return () => {
      if (pick === nextPick) pick = undefined
    }
  }

  const open = (workspaceId: string, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted()
    if (input.selectedWorkspace() === workspaceId) return Promise.resolve()
    const handoff = input.captureReferences()
    // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot the initiating composer; navigation remounts and replaces its binding.
    const select = pick
    if (select === undefined) return Promise.reject(new Error('The new-thread composer is no longer mounted.'))
    const lifetime = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        unsubscribe()
        lifetime.removeEventListener('abort', abort)
      }
      const abort = () => {
        cleanup()
        reject(lifetime.reason)
      }
      let resolving = false
      const changed = () => {
        if (input.selectedWorkspace() !== workspaceId || resolving) return
        resolving = true
        cleanup()
        if (handoff === undefined) {
          resolve()
          return
        }
        try {
          void input.restoreReferences({ workspaceId, handoff, signal: lifetime }).then(resolve, reject)
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

  return { bind, open }
}
