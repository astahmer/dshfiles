import { describe, expect, it } from 'vitest'
import { openChatExternalLink } from '../src/native/chat/external-link-opening.ts'

const createOpeners = () => {
  const openedInSidebar: string[] = []
  const openedInNewTab: string[] = []

  return {
    openedInSidebar,
    openedInNewTab,
    openInSidebar: (href: string): void => {
      openedInSidebar.push(href)
    },
    openInNewTab: (href: string): void => {
      openedInNewTab.push(href)
    },
  }
}

describe('Chat external link opening', () => {
  it('opens same-origin thread links in a new tab even when the sidebar is preferred', () => {
    const openers = createOpeners()
    const url = new URL('http://127.0.0.1:3080/?thread=session-abc')

    openChatExternalLink({
      url,
      currentOrigin: 'http://127.0.0.1:3080',
      linkOpening: 'sidebar',
      browserAvailable: true,
      openInSidebar: openers.openInSidebar,
      openInNewTab: openers.openInNewTab,
    })

    expect(openers.openedInSidebar).toEqual([])
    expect(openers.openedInNewTab).toEqual([url.href])
  })

  it('preserves the sidebar preference for same-origin links without a thread parameter', () => {
    const openers = createOpeners()
    const url = new URL('http://127.0.0.1:3080/settings')

    openChatExternalLink({
      url,
      currentOrigin: 'http://127.0.0.1:3080',
      linkOpening: 'sidebar',
      browserAvailable: true,
      openInSidebar: openers.openInSidebar,
      openInNewTab: openers.openInNewTab,
    })

    expect(openers.openedInSidebar).toEqual([url.href])
    expect(openers.openedInNewTab).toEqual([])
  })

  it('preserves the sidebar preference for cross-origin thread links', () => {
    const openers = createOpeners()
    const url = new URL('https://dsh.example.test/?thread=session-remote')

    openChatExternalLink({
      url,
      currentOrigin: 'http://127.0.0.1:3080',
      linkOpening: 'sidebar',
      browserAvailable: true,
      openInSidebar: openers.openInSidebar,
      openInNewTab: openers.openInNewTab,
    })

    expect(openers.openedInSidebar).toEqual([url.href])
    expect(openers.openedInNewTab).toEqual([])
  })

  it('preserves new-tab and browser-unavailable choices for other URLs', () => {
    const openers = createOpeners()
    const url = new URL('https://docs.example.test/guide')

    openChatExternalLink({
      url,
      currentOrigin: 'http://127.0.0.1:3080',
      linkOpening: 'new-tab',
      browserAvailable: true,
      openInSidebar: openers.openInSidebar,
      openInNewTab: openers.openInNewTab,
    })
    openChatExternalLink({
      url,
      currentOrigin: 'http://127.0.0.1:3080',
      linkOpening: 'sidebar',
      browserAvailable: false,
      openInSidebar: openers.openInSidebar,
      openInNewTab: openers.openInNewTab,
    })

    expect(openers.openedInSidebar).toEqual([])
    expect(openers.openedInNewTab).toEqual([url.href, url.href])
  })
})
