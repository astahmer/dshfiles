import { useSyncExternalStore } from 'react'

/**
 * The phone shell (thread-sidebar marks the document with `data-shell-phone-nav`) folds secondary thread controls
 * behind one menu. Header controls move into the menu; controls elsewhere opt in with `data-phone-thread-tool` and
 * stay hidden on a phone until the document carries the open attribute.
 */
const OPEN_ATTRIBUTE = 'data-phone-thread-tools'
const PHONE_ATTRIBUTE = 'data-shell-phone-nav'

const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

const subscribeOpen = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const subscribePhone = (listener: () => void): (() => void) => {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [PHONE_ATTRIBUTE] })
  return () => {
    observer.disconnect()
  }
}

const readOpen = (): boolean => document.documentElement.hasAttribute(OPEN_ATTRIBUTE)

const readPhone = (): boolean => document.documentElement.hasAttribute(PHONE_ATTRIBUTE)

const readServer = (): boolean => false

export const togglePhoneThreadTools = (): void => {
  document.documentElement.toggleAttribute(OPEN_ATTRIBUTE)
  notify()
}

export const usePhoneThreadToolsOpen = (): boolean => useSyncExternalStore(subscribeOpen, readOpen, readServer)

export const usePhoneShell = (): boolean => useSyncExternalStore(subscribePhone, readPhone, readServer)
