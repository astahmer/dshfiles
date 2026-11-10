import { useSyncExternalStore } from 'react'

const subscribe = (listener: () => void): (() => void) => {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-shell-phone-nav'] })
  return () => observer.disconnect()
}
const read = (): boolean => document.documentElement.hasAttribute('data-shell-phone-nav')
export const usePhoneShell = (): boolean => useSyncExternalStore(subscribe, read, () => false)
