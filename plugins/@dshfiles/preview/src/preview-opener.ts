import { useSyncExternalStore } from 'react'
import { Browser, useContract, type BrowserService, type Subscribable } from '@dshfiles/dshx/client'

/** Where an Open click landed: the browser pane beside the thread, or a new browser tab when no pane can take it. */
export type PreviewTarget = 'pane' | 'tab'

const NO_PANE: Subscribable<boolean> = { get: () => false, subscribe: () => () => {} }

/**
 * Open a URL in the pane when it accepts it, otherwise in a new browser tab, so Open never does nothing.
 * @param input - the pane (absent without a provider), the URL, and the new-tab opener.
 * @returns which surface took the URL.
 */
const open = (input: { readonly pane: BrowserService | undefined; readonly url: string; readonly newTab: (url: string) => void }): PreviewTarget => {
  if (input.pane?.open(input.url) === true) return 'pane'
  input.newTab(input.url)
  return 'tab'
}

const newBrowserTab = (url: string): void => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** The pane's live availability and an `open` that falls back to a new tab. */
const usePreviewOpener = () => {
  const browser = useContract(Browser)
  const pane = browser.status === 'active' ? browser.value : undefined
  const available = pane?.available ?? NO_PANE
  const paneAvailable = useSyncExternalStore(available.subscribe, available.get, available.get)
  return { paneAvailable, open: (url: string): PreviewTarget => open({ pane, url, newTab: newBrowserTab }) }
}

export class PreviewOpener {
  static readonly open = open
  static readonly use = usePreviewOpener
}
