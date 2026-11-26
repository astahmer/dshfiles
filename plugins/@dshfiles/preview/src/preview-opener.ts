import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { Browser, useApi, useContract, type BrowserService, type Subscribable } from '@dshfiles/dshx/client'
import { previewApi } from './api.js'
import type { EmbedCheck } from './embed-policy.js'
import { PreviewEmbedCache } from './preview-embed-cache.js'
import { RemoteReach, type ListeningPort, type Reach, type Viewer } from './remote-reach.js'

/** Where an Open click landed: the browser pane beside the thread, a new browser tab, or no page at all (a notice says why). */
export type PreviewTarget = 'pane' | 'tab'

/** `blocked` is an Open answered by a notice instead of a page; `null` stays the loopback-only case the Host must load. */
export type PreviewOutcome = PreviewTarget | 'blocked' | null

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

/** A page the pane cannot show, and why: the Host read its framing headers before the pane committed to it. */
export interface EmbedNotice {
  readonly kind: 'embed'
  readonly url: string
  readonly verdict: 'refused' | 'unreachable'
  readonly message: string
  readonly fix: string
  /** A way out when the pane already took the URL: open it where a refusal does not apply. */
  readonly action?: { readonly label: string; readonly run: () => void }
}

/** Why an Open click did not end in the pane. */
export type PreviewNotice = LoopbackNotice | EmbedNotice

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * The notice an answered check deserves, or null when the pane can show the page.
 * @param check - the Host's answer for this address.
 * @param input - whether a browser tab was opened for it before the pane saw the answer.
 */
const embedNotice = (check: EmbedCheck, input: { readonly tabOpened: boolean } = { tabOpened: false }): EmbedNotice | null => {
  if (check.framing === 'denied') {
    const host = hostOf(check.url)
    const policy = check.detail ?? 'its framing headers'
    const refused = {
      kind: 'embed',
      url: check.url,
      verdict: 'refused',
      message: input.tabOpened
        ? `${host} refuses to be embedded (${policy}), so it was opened in a browser tab instead of the blank Browser tab.`
        : `${host} refuses to be embedded (${policy}), so the Browser tab can only show a blank page for it.`,
      fix: 'Sites that send X-Frame-Options or a frame-ancestors policy can only be shown in a browser tab, not beside the thread.',
    } satisfies EmbedNotice
    if (input.tabOpened) return refused
    return { ...refused, action: { label: 'Open in browser tab', run: () => newBrowserTab(check.url) } }
  }
  if (check.reachable) return null
  const host = hostOf(check.url)
  // A dev server named by the machine the GUI runs on, with nothing on that interface: stopped, or bound to loopback
  // only, which is the case the Host's own preview pages already explain (T6.4).
  const sameMachine = typeof window !== 'undefined' && URL.canParse(check.url) && new URL(check.url).hostname === window.location.hostname
  return {
    kind: 'embed',
    url: check.url,
    verdict: 'unreachable',
    message: sameMachine
      ? `Nothing answered at ${host}. The dev server has stopped, or it listens on 127.0.0.1 only, so ${host} cannot reach it.`
      : `Nothing answered at ${host}. The dev server has probably stopped; start it again and Open.`,
    fix: sameMachine
      ? 'Start it listening on every interface, e.g. `vite --host 0.0.0.0`, then Open it again.'
      : 'Without a listener on that port the pane has nothing to show; the command and its thread are listed here.',
  }
}

export type PreviewEmbedProbe = (url: string) => Promise<EmbedCheck | undefined>

/**
 * The pane's live availability and an `open` that falls back to a new tab. On a GUI reached from another device
 * (Tailscale, the LAN), a port is opened on the Host's own name, and a loopback-only one leaves a notice with the fix
 * instead of a page that cannot load (T6.4). A page the Host knows refuses framing, or nothing answers for, leaves a
 * notice and a browser tab instead of the pane's permanent grey page: the iframe cannot report that itself.
 */
const usePreviewOpener = () => {
  const browser = useContract(Browser)
  const api = useApi(previewApi)
  const pane = browser.status === 'active' ? browser.value : undefined
  const available = pane?.available ?? NO_PANE
  const paneAvailable = useSyncExternalStore(available.subscribe, available.get, available.get)
  const [notice, setNotice] = useState<PreviewNotice | null>(null)
  const embeds = PreviewEmbedCache.shared

  /** The Host reads reachability and framing headers; a Host without this method simply never answers. */
  const probeRef = useRef<PreviewEmbedProbe>(() => Promise.resolve(undefined))
  probeRef.current = url => {
    const probeEmbed = api.probeEmbed
    if (probeEmbed === undefined) return Promise.resolve(undefined)
    try {
      return Promise.resolve(probeEmbed({ url })).then(
        check => check,
        () => undefined,
      )
    } catch {
      // An older Host rejects the method before it reaches the wire.
      return Promise.resolve(undefined)
    }
  }
  const ask = useCallback(
    (input: { readonly url: string; readonly onSettled?: (check: EmbedCheck) => void }) => {
      embeds.ask({ ...input, probe: url => probeRef.current(url) })
    },
    [embeds],
  )

  const warmPorts = useCallback(
    (ports: readonly ListeningPort[]): void => {
      for (const port of ports) {
        const reach = RemoteReach.port(port, viewer())
        if (reach.kind === 'open') ask({ url: reach.url })
      }
    },
    [ask],
  )

  const follow = (reach: Reach): PreviewOutcome => {
    if (reach.kind === 'loopback-only') {
      setNotice(reach)
      return null
    }
    const known = embeds.get(reach.url)
    if (known !== undefined) {
      const embed = embedNotice(known, { tabOpened: known.framing === 'denied' })
      if (embed !== null && embed.verdict === 'refused') {
        setNotice(embed)
        newBrowserTab(reach.url)
        return 'tab'
      }
      if (embed !== null) {
        // Nothing listens there: a tab would show the browser's own dead page, so the notice is the whole answer.
        setNotice(embed)
        return 'blocked'
      }
    }
    setNotice(null)
    if (reach.newTab) {
      newBrowserTab(reach.url)
      return 'tab'
    }
    const target = open({ pane, url: reach.url, newTab: newBrowserTab })
    ask({
      url: reach.url,
      onSettled: check => {
        const embed = embedNotice(check)
        if (embed !== null) setNotice(embed)
      },
    })
    return target
  }
  return {
    paneAvailable,
    notice,
    dismissNotice: () => setNotice(null),
    /** Ask the Host about addresses before a click needs the answer (a listed dev server). */
    warmPorts,
    /** Open one listening port of a dev server. */
    openPort: (port: ListeningPort): PreviewOutcome => follow(RemoteReach.port(port, viewer())),
    /** Open a preview page's URL; `ports` are the thread's listed sockets, which say whether its port is reachable. */
    open: (url: string, ports: readonly ListeningPort[] = []): PreviewOutcome => follow(RemoteReach.url(url, ports, viewer())),
  }
}

export class PreviewOpener {
  static readonly open = open
  static readonly hostOnly = hostOnly
  static readonly use = usePreviewOpener
  static readonly embedNotice = embedNotice
}
