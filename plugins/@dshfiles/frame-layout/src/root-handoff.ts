declare global {
  // One per page: a reloaded bundle is a new module, so the parked placeholder lives on the page, not in the module.
  var __dshfilesFrameRootPlaceholder: (() => void) | undefined
}

/** How long the placeholder waits for the next frame, so a frame that was removed rather than reloaded still leaves. */
const PLACEHOLDER_GRACE_MS = 3_000

const releasePlaceholder = (): void => {
  const release = globalThis.__dshfilesFrameRootPlaceholder
  globalThis.__dshfilesFrameRootPlaceholder = undefined
  release?.()
}

/**
 * The frame's `root` registration across a client hot reload. The native renderer throws, and blanks the page, when
 * `root` has no registration at render time, and a reload disposes the old frame before the new bundle registers.
 * When the frame goes, `placeholder` registers an empty, childless `root` from a scope that outlives the frame (the
 * root context); the next frame removes it once its own registration is in, or the grace does when none follows.
 */
export const registerRootAcrossReloads = (options: { readonly register: () => () => void; readonly placeholder: () => () => void }): (() => void) => {
  const dispose = options.register()
  releasePlaceholder()
  return () => {
    releasePlaceholder()
    const disposePlaceholder = options.placeholder()
    const timer = setTimeout(releasePlaceholder, PLACEHOLDER_GRACE_MS)
    globalThis.__dshfilesFrameRootPlaceholder = () => {
      clearTimeout(timer)
      disposePlaceholder()
    }
    dispose()
  }
}
