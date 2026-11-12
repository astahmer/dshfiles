/**
 * Applies the Appearance settings to the page (visual refresh T6.1). The static theme in `client.css` is the
 * first paint and the whole theme for the default; a non-default theme is one extra `<style>` whose selectors out-rank
 * the static block, so its position among the sheets does not matter.
 *
 * The last non-default CSS is cached in localStorage and applied as soon as the bundle runs, before the settings
 * mirror answers, so a reload of a custom theme does not flash warm stone first. The settings value always wins once
 * it arrives; the cache is presentation only and is cleared when the theme returns to the default.
 */
export const RUNTIME_STYLE_ID = 'dshfiles-ui-styles-theme'
export const RUNTIME_CACHE_KEY = 'dshfiles-ui-styles:theme-css:v1'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const safeStorage = (): StorageLike | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** Put `css` into the runtime style element, or remove the element when `css` is empty. */
export function applyThemeCss(doc: Pick<Document, 'getElementById' | 'createElement' | 'head'>, css: string): void {
  const existing = doc.getElementById(RUNTIME_STYLE_ID)
  if (css === '') {
    existing?.remove()
    return
  }
  const style = existing !== null && existing.tagName === 'STYLE' ? existing : doc.createElement('style')
  style.id = RUNTIME_STYLE_ID
  if (style.textContent !== css) style.textContent = css
  if (style.parentNode === null) doc.head.append(style)
}

export function readCachedThemeCss(storage: StorageLike | undefined = safeStorage()): string {
  try {
    return storage?.getItem(RUNTIME_CACHE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeCachedThemeCss(css: string, storage: StorageLike | undefined = safeStorage()): void {
  try {
    if (css === '') storage?.removeItem(RUNTIME_CACHE_KEY)
    else storage?.setItem(RUNTIME_CACHE_KEY, css)
  } catch {
    // Private mode or a full quota: the theme still applies, only the reload cache is lost.
  }
}
