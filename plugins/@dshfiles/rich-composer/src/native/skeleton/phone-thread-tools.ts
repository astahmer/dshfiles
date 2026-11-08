import { useSyncExternalStore } from 'react'

/**
 * The phone shell (`data-shell-phone-nav`) folds secondary thread controls behind one toggle. Controls opt in with
 * `data-phone-thread-tool`; they stay hidden on a phone until the document carries this attribute.
 */
const OPEN_ATTRIBUTE = 'data-phone-thread-tools'

const listeners = new Set<() => void>()

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const readOpen = (): boolean => document.documentElement.hasAttribute(OPEN_ATTRIBUTE)

const readServer = (): boolean => false

export const togglePhoneThreadTools = (): void => {
  document.documentElement.toggleAttribute(OPEN_ATTRIBUTE)
  for (const listener of listeners) listener()
}

export const usePhoneThreadToolsOpen = (): boolean => useSyncExternalStore(subscribe, readOpen, readServer)
