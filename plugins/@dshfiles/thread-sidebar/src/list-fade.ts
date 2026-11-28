/**
 * The thread list's bottom fade (round nine B6). The list fades its last 24px (14px on touch) so a row scrolled to the
 * status bar thins out instead of being cut. A selected row that reaches into that zone is the row the user is on, so
 * the fade steps aside for it: the scroller gets `data-fade-off` and its mask turns off, and nothing scrolls (a scroll
 * would slide another row under a sticky group head). The user's next scroll restores the fade.
 */
const FADE_OFF = 'data-fade-off'

/** The fade the list draws: 24px, 14px under a coarse pointer. */
const height = (coarse: boolean): number => (coarse ? 14 : 24)

/** Turn the fade off while the selected row shows inside the fade zone; on otherwise. */
const sync = (area: HTMLElement, selectedId: string | undefined, fade: number): void => {
  const row = selectedId === undefined ? undefined : [...area.querySelectorAll<HTMLElement>('article[data-thread-id]')].find(candidate => candidate.dataset.threadId === selectedId)
  if (row === undefined) {
    area.removeAttribute(FADE_OFF)
    return
  }
  const box = row.getBoundingClientRect()
  const bottom = area.getBoundingClientRect().bottom
  area.toggleAttribute(FADE_OFF, box.top < bottom && box.bottom > bottom - fade)
}

/** The user scrolled: the fade comes back. */
const restore = (area: HTMLElement): void => area.removeAttribute(FADE_OFF)

export class ListFade {
  static readonly height = height
  static readonly sync = sync
  static readonly restore = restore
}
