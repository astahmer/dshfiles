interface ThreadLinkClickInput {
  readonly document: Document
  readonly origin: string
  /** Open the named thread in the strip; false leaves the click to the browser. */
  readonly openThread: (sessionId: string) => boolean
}

/**
 * The thread a same-origin link names, so a click opens a strip tab instead of loading the whole app again.
 * Relative destinations resolve against the current origin, which is how the backlog writes its thread links.
 */
export const threadSessionIdOf = (input: { readonly href: string | null; readonly origin: string }): string | undefined => {
  if (input.href === null) return undefined
  let url: URL
  try {
    url = new URL(input.href, `${input.origin}/`)
  } catch {
    return undefined
  }
  if (url.origin !== input.origin) return undefined
  const thread = url.searchParams.get('thread')
  return thread === null || !thread.startsWith('session-') ? undefined : thread
}

/**
 * Route a plain click on a same-origin thread link into a tab before any other handler sees it: a document load
 * replaces the app, which inside an installed PWA looks like the page reloading. Modified clicks keep their browser
 * behavior, and an unhandled thread (one the strip cannot open) keeps the link's own navigation.
 */
export const installThreadLinkClicks = (input: ThreadLinkClickInput): (() => void) => {
  const onClick = (event: MouseEvent): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    const sessionId = threadSessionIdOf({ href: anchor?.getAttribute('href') ?? null, origin: input.origin })
    if (sessionId === undefined || !input.openThread(sessionId)) return
    event.preventDefault()
    event.stopPropagation()
  }
  input.document.addEventListener('click', onClick, true)
  return () => {
    input.document.removeEventListener('click', onClick, true)
  }
}
