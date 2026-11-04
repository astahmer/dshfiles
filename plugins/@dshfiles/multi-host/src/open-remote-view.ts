/**
 * Send a tab to a host's own DSH. With a thread URL, the sign-in link is fetched first so the host sets its cookie,
 * then the tab opens the thread signed in; DSH's sign-in redirect would otherwise drop `?thread=`. The cookie is only
 * kept when this page and the host share a machine name (both 127.0.0.1), so any other case opens the host home.
 */
export const openRemoteView = async (input: { readonly tab: Window; readonly launchUrl: string; readonly threadUrl?: string | undefined }): Promise<void> => {
  input.tab.opener = null
  const sameSite = new URL(input.launchUrl).hostname === window.location.hostname
  if (input.threadUrl === undefined || !sameSite) {
    input.tab.location.href = input.launchUrl
    return
  }
  const signedIn = await fetch(input.launchUrl, { credentials: 'include', mode: 'no-cors', cache: 'no-store' }).then(
    () => true,
    () => false,
  )
  input.tab.location.href = signedIn ? input.threadUrl : input.launchUrl
}
