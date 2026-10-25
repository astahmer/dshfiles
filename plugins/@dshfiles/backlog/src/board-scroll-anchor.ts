import { BacklogItems, type BacklogStatus } from './item.js'

export type BoardColumnScrollAnchor = {
  readonly status: BacklogStatus
  readonly itemId: number
  readonly top: number
  readonly scrollTop: number
}

export class BoardScrollAnchors {
  static scrollTopForAnchor(anchor: Pick<BoardColumnScrollAnchor, 'top' | 'scrollTop'>, nextTop: number): number {
    return anchor.scrollTop + nextTop - anchor.top
  }

  static capture(root: HTMLElement): BoardColumnScrollAnchor[] {
    return Array.from(root.querySelectorAll<HTMLElement>('[data-backlog-column]')).flatMap(column => {
      const rawStatus = column.dataset['backlogColumn']
      const status = BacklogItems.statuses.find(candidate => candidate === rawStatus)
      const scroller = column.querySelector<HTMLElement>('[data-backlog-column-scroll]')
      if (status === undefined || scroller === null) return []

      const viewport = scroller.getBoundingClientRect()
      const anchorCard = Array.from(scroller.querySelectorAll<HTMLElement>('[data-backlog-card-id]')).find(card => {
        const bounds = card.getBoundingClientRect()
        return bounds.bottom > viewport.top && bounds.top < viewport.bottom
      })
      if (anchorCard === undefined) return []

      const itemId = Number(anchorCard.dataset['backlogCardId'])
      if (!Number.isSafeInteger(itemId)) return []

      return [{ status, itemId, top: anchorCard.getBoundingClientRect().top, scrollTop: scroller.scrollTop }]
    })
  }

  static restore(root: HTMLElement, anchors: readonly BoardColumnScrollAnchor[]): void {
    for (const anchor of anchors) {
      const column = root.querySelector<HTMLElement>(`[data-backlog-column="${anchor.status}"]`)
      const scroller = column?.querySelector<HTMLElement>('[data-backlog-column-scroll]')
      const card = scroller?.querySelector<HTMLElement>(`[data-backlog-card-id="${String(anchor.itemId)}"]`)
      if (scroller === null || scroller === undefined || card === null || card === undefined) continue

      scroller.scrollTop = BoardScrollAnchors.scrollTopForAnchor(anchor, card.getBoundingClientRect().top)
    }
  }
}
