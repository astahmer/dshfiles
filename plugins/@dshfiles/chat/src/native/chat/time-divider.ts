/**
 * dshfiles (productivity pass T1.5): times leave every message row and show only as a centred divider above a user
 * message that starts a new day or follows more than 30 minutes of quiet, and above the thread's first turn. A turn
 * whose predecessor is not loaded yet gets none: older history paging in must not change rows already on screen.
 */
import type { ChatSnapshot } from '../contract/snapshot.ts'

/** Quiet time after which the next message gets a time divider. */
export const TIME_DIVIDER_GAP_MS = 30 * 60 * 1000

const localDay = (ms: number): string => {
  const date = new Date(ms)
  return `${String(date.getFullYear())}-${String(date.getMonth())}-${String(date.getDate())}`
}

/** The first turn number a thread records. */
const FIRST_TURN = 1

/**
 * @param previous - when the turn before ended (its last timed row), or undefined when no earlier turn is loaded.
 * @param current - when this message was sent.
 * @param turn - this message's turn number: with no loaded predecessor only the thread's first turn takes a divider.
 */
export const needsTimeDivider = (previous: number | undefined, current: number, turn: number): boolean =>
  previous === undefined
    ? turn <= FIRST_TURN
    : localDay(previous) !== localDay(current) || current - previous > TIME_DIVIDER_GAP_MS

/** The latest time any row of the turn before `turn` carries, or undefined when there is none loaded. */
export const previousTurnTime = (snapshot: ChatSnapshot, turn: number): number | undefined => {
  const order = snapshot.timeline.turnOrder
  const index = order.indexOf(turn)
  if (index <= 0) return undefined
  const previous = order[index - 1]
  if (previous === undefined) return undefined
  let latest: number | undefined
  for (const key of snapshot.locations.getTurn(previous)) {
    const node = snapshot.nodes.get(key) as { readonly data?: { readonly time?: unknown; readonly closing?: { readonly time?: unknown } | null } } | undefined
    for (const time of [node?.data?.time, node?.data?.closing?.time]) {
      if (typeof time === 'number' && (latest === undefined || time > latest)) latest = time
    }
  }
  return latest
}
