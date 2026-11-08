import { useSyncExternalStore } from 'react'

/**
 * The phone shell (thread-sidebar marks the document with `data-shell-phone-nav`) names the thread in its top bar and
 * owns the thread menu button, which sets `data-phone-thread-tools` on the document. The header reads both: on a phone
 * it drops its own title row and shows the thread menu while that attribute is set.
 *
 * Controls other plugins render in the composer opt into the menu with `data-phone-thread-tool="<label>"`. On a phone
 * they stay hidden; the menu lists them by label and opening one reveals it in place and activates it.
 */
const PHONE_ATTRIBUTE = 'data-shell-phone-nav'
const OPEN_ATTRIBUTE = 'data-phone-thread-tools'
const TOOL_ATTRIBUTE = 'data-phone-thread-tool'
const REVEALED_ATTRIBUTE = 'data-phone-thread-tool-revealed'
const OPEN_STATE = '[aria-expanded="true"], [data-state="open"]'
/** A revealed button that never reports an open state (a dialog opener) hides again after this delay. */
const UNOPENED_REVEAL_MILLISECONDS = 1500

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

export const closePhoneThreadTools = (): void => document.documentElement.removeAttribute(OPEN_ATTRIBUTE)

export const concealPhoneThreadTools = (): void => {
  for (const element of document.querySelectorAll(`[${REVEALED_ATTRIBUTE}]`)) element.removeAttribute(REVEALED_ATTRIBUTE)
}

export interface PhoneThreadTool {
  readonly element: HTMLElement
  readonly label: string
}

const toolLabel = (element: HTMLElement): string =>
  element.getAttribute(TOOL_ATTRIBUTE)?.trim() || element.getAttribute('aria-label')?.trim() || element.textContent?.trim() || ''

/** The opted-in controls of the conversation that holds `from`: the nearest ancestor that also holds a composer. */
export const findPhoneThreadTools = (from: Element): readonly PhoneThreadTool[] => {
  let scope = from.parentElement
  while (scope !== null && scope.querySelector('[data-composer-input]') === null) scope = scope.parentElement
  if (scope === null) return []
  return Array.from(scope.querySelectorAll<HTMLElement>(`[${TOOL_ATTRIBUTE}]`), element => ({ element, label: toolLabel(element) })).filter(
    tool => tool.label.length > 0,
  )
}

const isOpen = (element: HTMLElement): boolean => element.matches(OPEN_STATE) || element.querySelector(OPEN_STATE) !== null

/**
 * Close the menu, reveal one tool where its plugin rendered it, and activate it. A button hides again once the
 * popover it opened closes; a panel (the change ribbon) stays until the menu opens again.
 */
export const openPhoneThreadTool = (element: HTMLElement): void => {
  closePhoneThreadTools()
  concealPhoneThreadTools()
  element.setAttribute(REVEALED_ATTRIBUTE, '')
  const button = element instanceof HTMLButtonElement ? element : element.querySelector<HTMLButtonElement>('button:not(:disabled)')
  requestAnimationFrame(() => {
    button?.click()
    if (!(element instanceof HTMLButtonElement)) return
    let opened = false
    const conceal = (): void => {
      observer.disconnect()
      window.clearTimeout(fallback)
      element.removeAttribute(REVEALED_ATTRIBUTE)
    }
    const settle = (): void => {
      if (isOpen(element)) opened = true
      else if (opened) conceal()
    }
    const observer = new MutationObserver(settle)
    observer.observe(element, { attributes: true, subtree: true, attributeFilter: ['aria-expanded', 'data-state'] })
    const fallback = window.setTimeout(() => {
      if (!opened && !isOpen(element)) conceal()
    }, UNOPENED_REVEAL_MILLISECONDS)
    settle()
  })
}
