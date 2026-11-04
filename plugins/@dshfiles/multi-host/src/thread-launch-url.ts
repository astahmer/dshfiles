/** The host's launch URL opened on one of its threads: the DSH shell selects `?thread=` once the token signs in. */
export const threadLaunchUrl = (input: { readonly launchUrl: string; readonly sessionId: string }): string => {
  const url = new URL(input.launchUrl)
  url.searchParams.set('thread', input.sessionId)
  return url.toString()
}
