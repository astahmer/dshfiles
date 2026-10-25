import type { LinkOpening } from '../../chat-settings.ts'

export const openChatExternalLink = (input: {
  readonly url: URL
  readonly currentOrigin: string
  readonly linkOpening: LinkOpening
  readonly browserAvailable: boolean
  readonly openInSidebar: (href: string) => void
  readonly openInNewTab: (href: string) => void
}): void => {
  const isCurrentThreadLink = input.url.origin === input.currentOrigin && input.url.searchParams.has('thread')
  if (isCurrentThreadLink) {
    input.openInNewTab(input.url.href)
    return
  }

  if (input.linkOpening === 'sidebar' && input.browserAvailable) {
    input.openInSidebar(input.url.href)
    return
  }

  input.openInNewTab(input.url.href)
}
