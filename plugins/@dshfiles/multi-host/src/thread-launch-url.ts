/**
 * The host's own address opened on one of its threads, without the sign-in token: DSH answers a token link with a
 * redirect to `./` that drops every other parameter, so `?thread=` only survives on a request that is already signed in.
 */
export const threadViewUrl = (input: { readonly launchUrl: string; readonly sessionId: string }): string => {
  const url = new URL(input.launchUrl)
  url.search = ''
  url.hash = ''
  url.searchParams.set('thread', input.sessionId)
  return url.toString()
}
