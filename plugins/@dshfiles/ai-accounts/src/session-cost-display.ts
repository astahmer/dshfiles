export interface SessionCostDisplayValue {
  readonly amount: string
  readonly description: string
  readonly rows: readonly { readonly label: string; readonly value: string }[]
}

const STATS_ROOT = '[data-composer-stats]'
const DIALOG_TRIGGER = 'button[aria-haspopup="dialog"]'
const DOCK_ANCHOR = '[data-slot="conversation.composer.dock"]'
const COST_ATTRIBUTE = 'data-ai-accounts-session-cost'

/** Appends the estimate to the shipped token-stats button without replacing its owner. */
export class SessionCostDisplay {
  private readonly doc: Document
  private readonly scope: () => ParentNode | null
  private observer: MutationObserver | undefined
  private value: SessionCostDisplayValue | undefined
  private host: Element | undefined
  private node: HTMLSpanElement | undefined
  private dialog: HTMLDListElement | undefined
  private dialogRows: HTMLDivElement[] = []

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
    this.node?.remove()
    this.node = undefined
    this.host = undefined
    this.removeDialogRows()
  }

  private apply(): void {
    if (this.value === undefined) {
      this.node?.remove()
      this.node = undefined
      this.host = undefined
      this.removeDialogRows()
      return
    }

    const value = this.value
    this.applyPill(value)
    this.applyDialog(value)
  }

  private applyPill(value: SessionCostDisplayValue): void {
    if (this.host?.isConnected !== true || this.node?.isConnected !== true) {
      const scope = this.scope()
      if (scope === null) return
      const stats = scope.querySelector(STATS_ROOT) ?? scope
      const buttons = stats.querySelectorAll(DIALOG_TRIGGER)
      const host = buttons.item(buttons.length - 1)
      if (host === null) return
      this.node?.remove()
      const node = this.doc.createElement('span')
      node.setAttribute(COST_ATTRIBUTE, '')
      node.textContent = ` · ${value.amount}`
      node.title = value.description
      node.setAttribute('aria-label', value.description)
      host.append(node)
      this.host = host
      this.node = node
      return
    }

    const text = ` · ${value.amount}`
    if (this.node.textContent !== text) this.node.textContent = text
    if (this.node.title !== value.description) this.node.title = value.description
    if (this.node.getAttribute('aria-label') !== value.description) this.node.setAttribute('aria-label', value.description)
  }

  private applyDialog(value: SessionCostDisplayValue): void {
    const scope = this.scope()
    const stats = scope?.querySelector(STATS_ROOT) ?? scope
    const buttons = stats?.querySelectorAll(DIALOG_TRIGGER)
    const tokenButton = buttons?.item((buttons?.length ?? 0) - 1)
    const ownsOpenDialog = tokenButton?.getAttribute('aria-expanded') === 'true'
    const dialog = ownsOpenDialog ? this.doc.querySelector<HTMLDListElement>('[data-session-stats-usage]') : null
    if (dialog === null) {
      this.removeDialogRows()
      return
    }
    if (this.dialog !== dialog || this.dialogRows.length !== value.rows.length || this.dialogRows.some(row => !row.isConnected)) {
      this.removeDialogRows()
      this.dialog = dialog
      this.dialogRows = value.rows.map(({ label, value }) => {
        const row = this.doc.createElement('div')
        row.setAttribute(COST_ATTRIBUTE, '')
        row.style.display = 'contents'
        const term = this.doc.createElement('dt')
        term.textContent = label
        const detail = this.doc.createElement('dd')
        detail.textContent = value
        row.append(term, detail)
        dialog.append(row)
        return row
      })
      return
    }
    value.rows.forEach((entry, index) => {
      const row = this.dialogRows[index]
      const term = row?.querySelector('dt')
      const detail = row?.querySelector('dd')
      if (term !== null && term !== undefined && term.textContent !== entry.label) term.textContent = entry.label
      if (detail !== null && detail !== undefined && detail.textContent !== entry.value) detail.textContent = entry.value
    })
  }

  private removeDialogRows(): void {
    for (const row of this.dialogRows) row.remove()
    this.dialogRows = []
    this.dialog = undefined
  }
}

export const sessionCostDockScope = (marker: Element | null): ParentNode | null => marker?.closest(DOCK_ANCHOR) ?? null
