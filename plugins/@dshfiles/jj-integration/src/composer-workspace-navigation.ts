export const createComposerWorkspaceNavigation = (input: {
  readonly selectedWorkspace: () => string | undefined
  readonly subscribe: (listener: () => void) => () => void
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
      const changed = () => {
        if (input.selectedWorkspace() !== workspaceId) return
        cleanup()
        resolve()
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
