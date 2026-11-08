import { useSyncExternalStore } from 'react'

/**
 * The phone shell (thread-sidebar marks the document with `data-shell-phone-nav`) names the thread in its top bar and
 * owns the thread menu button, which sets `data-phone-thread-tools` on the document. The header reads both: on a phone
 * it drops its own title row and shows its controls in a drawer only while the menu is open.
 */
const PHONE_ATTRIBUTE = 'data-shell-phone-nav'
const OPEN_ATTRIBUTE = 'data-phone-thread-tools'

const documentAttribute = (name: string): (() => boolean) => {
  const subscribe = (listener: () => void): (() => void) => {
    const observer = new MutationObserver(listener)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [name] })
    return () => observer.disconnect()
  }
  const read = (): boolean => document.documentElement.hasAttribute(name)
  return () => useSyncExternalStore(subscribe, read, () => false)
}

export const usePhoneShell = documentAttribute(PHONE_ATTRIBUTE)

export const usePhoneThreadToolsOpen = documentAttribute(OPEN_ATTRIBUTE)
