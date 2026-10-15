interface ThreadTabLinkInput {
  readonly currentUrl: string
  readonly sessionId: string
  readonly workspaceId: string | undefined
}

export const buildThreadTabLink = ({ currentUrl, sessionId, workspaceId }: ThreadTabLinkInput): string => {
  const url = new URL(currentUrl)
  url.search = ''
  url.hash = ''
  url.searchParams.set('thread', sessionId)
  if (workspaceId !== undefined && workspaceId.length > 0) url.searchParams.set('workspace', workspaceId)
  return url.toString()
}
