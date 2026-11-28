import * as React from 'react'

/**
 * The page's one answer to "can DSH hear us?" (DESIGN.md Connection, D2). settings-shell owns it: it watches the
 * socket, probes the Host and publishes `online`, `reconnecting` or `offline` here. Everyone else reads it.
 *
 * dshx inlines the kit into each plugin bundle, so this module exists once per bundle. The state therefore lives on the
 * page, not in the module: `publish` writes `html[data-host-connection]` (absent when online) and dispatches
 * `dshfiles:host-connection` on `document`, and every reader reads that attribute. Two copies of the kit always agree,
 * and CSS can stop motion with the same attribute.
 */

export type HostConnectionState = 'online' | 'reconnecting' | 'offline'

/** settings-shell's probe view says `checking` while a probe is in flight after a failure: that is reconnecting. */
export type HostConnectionInput = HostConnectionState | 'checking'

export const HOST_CONNECTION_ATTRIBUTE = 'data-host-connection'
export const HOST_CONNECTION_EVENT = 'dshfiles:host-connection'

export interface HostConnectionEventDetail {
  readonly state: HostConnectionState
}

const normalize = (input: HostConnectionInput): HostConnectionState => (input === 'checking' ? 'reconnecting' : input)

const root = (): HTMLElement | undefined => (typeof document === 'undefined' ? undefined : document.documentElement)

const read = (): HostConnectionState => {
  const value = root()?.getAttribute(HOST_CONNECTION_ATTRIBUTE)
  return value === 'reconnecting' || value === 'offline' ? value : 'online'
}

const publish = (input: HostConnectionInput): void => {
  const element = root()
  if (element === undefined) return
  const state = normalize(input)
  if (state === read()) return
  if (state === 'online') element.removeAttribute(HOST_CONNECTION_ATTRIBUTE)
  else element.setAttribute(HOST_CONNECTION_ATTRIBUTE, state)
  const detail: HostConnectionEventDetail = { state }
  document.dispatchEvent(new CustomEvent(HOST_CONNECTION_EVENT, { detail }))
}

/** Calls `listener` with the new state after each change, from any kit copy; returns the unsubscribe. */
const subscribe = (listener: (state: HostConnectionState) => void): (() => void) => {
  if (typeof document === 'undefined') return () => undefined
  let last = read()
  const onChange = (): void => {
    const next = read()
    if (next === last) return
    last = next
    listener(next)
  }
  document.addEventListener(HOST_CONNECTION_EVENT, onChange)
  return () => document.removeEventListener(HOST_CONNECTION_EVENT, onChange)
}

export const HostConnection = {
  publish,
  read,
  subscribe,
  /** True unless DSH is known to be away; the cheap check for a clock or a verb. */
  isOnline: (): boolean => read() === 'online',
}

const serverSnapshot = (): HostConnectionState => 'online'

/** The connection state, re-rendering on each change. Offer archive, land or clean-up verbs only while it is `online`. */
export const useHostConnection = (): HostConnectionState => React.useSyncExternalStore(subscribe, read, serverSnapshot)
