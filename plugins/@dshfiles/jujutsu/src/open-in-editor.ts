/**
 * Asks @dshfiles/editor to open a workspace file through its `dshfiles:open-file` window event (see the editor's
 * open-file.ts contract). Returns true when an editor took the request; false when none is installed or no session is
 * on screen.
 */
export const openInEditor = (request: { readonly path: string; readonly cwd: string; readonly line?: number }): boolean =>
  !window.dispatchEvent(new CustomEvent('dshfiles:open-file', { detail: request, cancelable: true }))
