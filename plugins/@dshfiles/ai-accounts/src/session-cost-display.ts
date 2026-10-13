export interface SessionCostDialogRow {
  readonly tokens: number | undefined
  readonly amount: string | undefined
}

export interface SessionCostDisplayValue {
  readonly amount: string
  readonly description: string
  readonly rows: readonly SessionCostDialogRow[]
}

const STATS_ROOT = '[data-composer-stats]'
const DIALOG_TRIGGER = 'button[aria-haspopup="dialog"]'
const DOCK_ANCHOR = '[data-slot="conversation.composer.dock"]'
const COST_ATTRIBUTE = 'data-ai-accounts-session-cost'

/** Confirms the native dialog still has the rows represented by this session. */
export const sessionCostDialogMatches = (values: readonly string[], rows: readonly SessionCostDialogRow[]): boolean => {
  if (values.length !== rows.length) return false
  return rows.every((row, index) => {
    const value = values[index]
    if (value === undefined) return false
    if (row.tokens === undefined) return value.includes('%')
    return value.replace(/\D/g, '') === String(row.tokens)
  })
}

interface DialogPair {
  readonly detail: HTMLElement
}

/** Appends the estimate to the shipped token-stats button without replacing its owner. */
export class SessionCostDisplay {
  private readonly doc: Document
  private readonly scope: () => ParentNode | null
  private observer: MutationObserver | undefined
  private value: SessionCostDisplayValue | undefined
  private pillHost: Element | undefined
  private pillNode: HTMLSpanElement | undefined
  private dialogHost: HTMLDListElement | undefined
  private dialogPrices = new Map<HTMLElement, HTMLSpanElement>()

  constructor(doc: Document, scope: () => ParentNode | null) {
    this.doc = doc
    this.scope = scope
  }

  start(): void {
    if (typeof MutationObserver === 'undefined' || this.observer !== undefined) return
    this.observer = new MutationObserver(() => this.apply())
    this.observer.observe(this.doc.body, { childList: true, subtree: true })
    this.apply()
  }

  sync(value: SessionCostDisplayValue | undefined): void {
    this.value = value
    this.apply()
  }

  dispose(): void {
    this.observer?.disconnect()
    this.observer = undefined
    this.pillNode?.remove()
    this.pillNode = undefined
    this.pillHost = undefined
    this.clearDialog()
  }

  private apply(): void {
    if (this.value === undefined) {
      this.pillNode?.remove()
      this.pillNode = undefined
      this.pillHost = undefined
      this.clearDialog()
      return
    }

    this.applyPill(this.value)
    this.applyDialog(this.value)
  }

  private applyPill(value: SessionCostDisplayValue): void {
    if (this.pillHost?.isConnected !== true || this.pillNode?.isConnected !== true) {
      const scope = this.scope()
      if (scope === null) return
      const stats = scope.querySelector(STATS_ROOT) ?? scope
      const buttons = stats.querySelectorAll(DIALOG_TRIGGER)
      const host = buttons.item(buttons.length - 1)
      if (host === null) return
      this.pillNode?.remove()
      const node = this.doc.createElement('span')
      node.setAttribute(COST_ATTRIBUTE, '')
      node.textContent = ` · ${value.amount}`
      node.title = value.description
      node.setAttribute('aria-label', value.description)
      host.append(node)
      this.pillHost = host
      this.pillNode = node
      return
    }

    const text = ` · ${value.amount}`
    if (this.pillNode.textContent !== text) this.pillNode.textContent = text
    if (this.pillNode.title !== value.description) this.pillNode.title = value.description
    if (this.pillNode.getAttribute('aria-label') !== value.description) this.pillNode.setAttribute('aria-label', value.description)
  }

  private applyDialog(value: SessionCostDisplayValue): void {
    const scope = this.scope()
    const stats = scope?.querySelector(STATS_ROOT) ?? scope
    const buttons = stats?.querySelectorAll(DIALOG_TRIGGER)
    const tokenButton = buttons?.item((buttons?.length ?? 0) - 1)
    const ownsOpenDialog = tokenButton?.getAttribute('aria-expanded') === 'true'
    const dialogs = this.doc.querySelectorAll<HTMLDListElement>('[data-session-stats-usage]')
    const dialog = this.dialogHost?.isConnected === true ? this.dialogHost : ownsOpenDialog && dialogs.length === 1 ? dialogs.item(0) : null
    if (dialog === null) {
      this.clearDialog()
      return
    }

    this.pruneDialog(dialog)
    const pairs = this.dialogPairs(dialog)
    const rowValues = pairs.map(pair => this.hostValue(pair.detail))
    if (!sessionCostDialogMatches(rowValues, value.rows)) {
      this.clearDialog()
      return
    }

    for (const [index, row] of value.rows.entries()) {
      const pair = pairs[index]
      if (pair === undefined || row.amount === undefined) continue
      const price = this.dialogPrices.get(pair.detail) ?? this.createDialogPrice(pair.detail)
      if (price.parentNode !== pair.detail) pair.detail.append(price)
      if (price.textContent !== row.amount) price.textContent = row.amount
    }
    this.dialogHost = dialog
  }

  private dialogPairs(host: HTMLDListElement): DialogPair[] {
    const termCount = host.querySelectorAll<HTMLElement>(':scope > dt').length
    const details = host.querySelectorAll<HTMLElement>(':scope > dd')
    const pairs: DialogPair[] = []
    for (let index = 0; index < termCount; index++) {
      const detail = details.item(index)
      if (detail !== null) pairs.push({ detail })
    }
    return pairs
  }

  private hostValue(detail: HTMLElement): string {
    return Array.from(detail.childNodes)
      .filter(node => node !== this.dialogPrices.get(detail))
      .map(node => node.textContent ?? '')
      .join('')
  }

  private createDialogPrice(detail: HTMLElement): HTMLSpanElement {
    const price = this.doc.createElement('span')
    price.setAttribute(COST_ATTRIBUTE, '')
    price.style.marginLeft = '6px'
    price.style.display = 'inline-block'
    price.style.minWidth = '56px'
    price.style.textAlign = 'right'
    price.style.fontWeight = '500'
    detail.append(price)
    this.dialogPrices.set(detail, price)
    return price
  }

  private pruneDialog(host: HTMLDListElement): void {
    if (this.dialogHost !== undefined && this.dialogHost !== host) this.clearDialog()
    for (const [detail, price] of this.dialogPrices) {
      if (detail.parentElement === host) continue
      price.remove()
      this.dialogPrices.delete(detail)
    }
  }

  private clearDialog(): void {
    for (const price of this.dialogPrices.values()) price.remove()
    this.dialogPrices.clear()
    this.dialogHost = undefined
  }
}

export const sessionCostDockScope = (marker: Element | null): ParentNode | null => marker?.closest(DOCK_ANCHOR) ?? null
