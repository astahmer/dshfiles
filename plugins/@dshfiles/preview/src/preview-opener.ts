import { useState, useSyncExternalStore } from 'react'
import { Browser, useContract, type BrowserService, type Subscribable } from '@dshfiles/dshx/client'
import { RemoteReach, type ListeningPort, type Reach, type Viewer } from './remote-reach.js'

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

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|::1|\[::1\]|.+\.localhost)$/i

/**
 * Whether a URL names the DSH Host's own loopback while the GUI runs on another machine: the pane and a new tab load
 * in the viewer's browser, so they would reach the viewer's machine instead of the Host.
 * @param input - the GUI page's hostname and the URL to open.
 * @returns true when only the Host can load it.
 */
const hostOnly = (input: { readonly guiHostname: string; readonly url: string }): boolean => {
  if (LOOPBACK.test(input.guiHostname) || !URL.canParse(input.url)) return false
  return LOOPBACK.test(new URL(input.url).hostname)
}

const newBrowserTab = (url: string): void => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

const viewer = (): Viewer => ({ hostname: window.location.hostname, protocol: window.location.protocol })

export type LoopbackNotice = Extract<Reach, { kind: 'loopback-only' }>

/**
 * The pane's live availability and an `open` that falls back to a new tab. On a GUI reached from another device
 * (Tailscale, the LAN), a port is opened on the Host's own name, and a loopback-only one leaves a notice with the fix
 * instead of a page that cannot load (T6.4).
 */
const usePreviewOpener = () => {
  const browser = useContract(Browser)
  const pane = browser.status === 'active' ? browser.value : undefined
  const available = pane?.available ?? NO_PANE
  const paneAvailable = useSyncExternalStore(available.subscribe, available.get, available.get)
  const [notice, setNotice] = useState<LoopbackNotice | null>(null)
  const follow = (reach: Reach): PreviewTarget | null => {
    if (reach.kind === 'loopback-only') {
      setNotice(reach)
      return null
    }
    setNotice(null)
    if (!reach.newTab) return open({ pane, url: reach.url, newTab: newBrowserTab })
    newBrowserTab(reach.url)
    return 'tab'
  }
  return {
    paneAvailable,
    notice,
    dismissNotice: () => setNotice(null),
    /** Open one listening port of a dev server. */
    openPort: (port: ListeningPort): PreviewTarget | null => follow(RemoteReach.port(port, viewer())),
    /** Open a preview page's URL; `ports` are the thread's listed sockets, which say whether its port is reachable. */
    open: (url: string, ports: readonly ListeningPort[] = []): PreviewTarget | null => follow(RemoteReach.url(url, ports, viewer())),
  }
}

export class PreviewOpener {
  static readonly open = open
  static readonly hostOnly = hostOnly
  static readonly use = usePreviewOpener
}
