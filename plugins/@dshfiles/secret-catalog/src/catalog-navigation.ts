interface CatalogFocus {
  readonly alias: string
  readonly sequence: number
}

type Listener = () => void

/**
 * Lets a repair card outside the panel open the Secret Catalog filtered to one alias. The Client entry installs the
 * opener (it owns the layout port); the panel subscribes to the focus request and applies it once.
 */
export class CatalogNavigation {
  static #focus: CatalogFocus | null = null
  static #opener: (() => void) | null = null
  static readonly #listeners = new Set<Listener>()

  static setOpener(opener: (() => void) | null): void {
    CatalogNavigation.#opener = opener
  }

  static get available(): boolean {
    return CatalogNavigation.#opener !== null
  }

  static open(alias: string): void {
    CatalogNavigation.#focus = { alias, sequence: (CatalogNavigation.#focus?.sequence ?? 0) + 1 }
    for (const listener of CatalogNavigation.#listeners) listener()
    CatalogNavigation.#opener?.()
  }

  static readonly subscribe = (listener: Listener): (() => void) => {
    CatalogNavigation.#listeners.add(listener)
    return () => CatalogNavigation.#listeners.delete(listener)
  }

  static readonly focus = (): CatalogFocus | null => CatalogNavigation.#focus

  /** Takes the pending request once, so a panel remount later does not reapply an old filter. */
  static claim(): CatalogFocus | null {
    const focus = CatalogNavigation.#focus
    CatalogNavigation.#focus = null
    return focus
  }
}
