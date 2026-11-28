import { ChevronDownIcon } from '@dshfiles/plugin-ui/icons'
import { memo, useLayoutEffect, useRef } from 'react'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import type { ChatKey } from '../locale.ts'
import { turnProcessAlwaysOpen } from '../contract/turn-process.ts'
import { formatRunDuration } from './message-chrome.ts'
import a11yCss from './accessibility.module.css'
import css from './TurnProcessNodeView.module.css'

const scrollportOf = (element: HTMLElement): HTMLElement | null => {
  const shared = element.closest<HTMLElement>('[data-conversation-scroll]')
  if (shared !== null) return shared
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return null
}

/** How long a closing control waits for its row to take space before it stops watching. */
const INSERT_WATCH_MS = 2_000

/**
 * dshfiles (unslop R5): content inserted above the reader is compensated in the scroll offset. This control renders
 * nothing while its Turn runs, and its item takes a row and a gap once the Turn closes, possibly a commit after the
 * control mounts (the seat follows the process presentation). Native scroll anchoring (Chromium has it, WebKit does
 * not) is held off from the mount so nothing corrects twice. As soon as the item has a height (at the mount when the
 * row shows in the same commit, else at the first size observation, which arrives after that layout and before
 * paint), its height and gap are added to the scroll offset when it sits above what a reader who scrolled up is
 * reading (above the view's middle). A reader at the tail is left to the follow.
 * @param row - the control that just appeared.
 * @returns stops watching and gives anchoring back.
 */
export function holdReaderAboveInsert(row: HTMLElement): () => void {
  const item = row.closest<HTMLElement>('[data-chat-flow-kind="turn-process"]')
  const scroller = scrollportOf(row)
  if (row.closest('[data-chat-following-tail]') !== null || item === null || scroller === null
    || typeof ResizeObserver === 'undefined') return () => {}
  const anchoring = scroller.style.overflowAnchor
  scroller.style.overflowAnchor = 'none'
  const start = scroller.scrollTop
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    observer.disconnect()
    clearTimeout(deadline)
    requestAnimationFrame(() => {
      if (scroller.style.overflowAnchor === 'none') scroller.style.overflowAnchor = anchoring
    })
  }
  const settle = (): void => {
    const box = item.getBoundingClientRect()
    if (box.height === 0) return
    const view = scroller.getBoundingClientRect()
    if (row.closest('[data-chat-following-tail]') === null && box.top <= view.top + view.height / 2) {
      const inserted = box.height + Number.parseFloat(getComputedStyle(item).marginTop || '0')
      // Whatever already moved the offset since the mount (a browser that anchored anyway) counts against it.
      const missing = inserted - (scroller.scrollTop - start)
      if (missing > 0.5) scroller.scrollTop += missing
    }
    release()
  }
  const observer = new ResizeObserver(settle)
  const deadline = setTimeout(release, INSERT_WATCH_MS)
  observer.observe(item)
  settle()
  return release
}

/** Settled Turn duration and process disclosure above its content. */

/**
 * dshfiles (round four D14): what the hidden status says once a turn ends. A finished turn says "Reply ready" (the
 * reply is what the reader waited for, not that the agent "Worked"); a failure says "Turn failed"; a stop, "Stopped".
 */
export const turnEndAnnouncement = (reason: string | undefined, t: (key: ChatKey) => string): string =>
  reason === 'aborted' || reason === 'interrupted' ? t('message.stopped')
    : reason === 'error' ? t('message.turnProcess.turnFailed')
      : t('message.turnProcess.replyReady')
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  node, turnProcess, t,
}: ChatNodeViewProps<'turn-process'>) {
  if (turnProcess === undefined) throw new Error('turn-process node requires Turn process owner state')
  const open = !turnProcess.foldable || turnProcess.open
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const closed = turn?.status === 'closed'
  // A control mounted on a closed Turn (history, a thread opening) is already in place; only one whose Turn closes
  // while it is mounted is an insertion the reader sees.
  const mountedOpen = useRef(!closed)
  const entering = closed && mountedOpen.current
  const rowRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (!entering || rowRef.current === null) return undefined
    return holdReaderAboveInsert(rowRef.current)
  }, [entering])
  if (turn?.status !== 'closed') return null
  const canCollapse = turnProcess.foldable && turnProcess.hasContent && !turnProcessAlwaysOpen(node)
  const reason = turn.end?.data.reason.kind
  const stopped = reason === 'aborted' || reason === 'interrupted'
  const elapsedMs = turn.start === undefined || turn.end === undefined ? undefined
    : Math.max(1000, turn.end.time - turn.start.time)
  const duration = elapsedMs === undefined || stopped || reason === 'error' ? undefined
    : formatRunDuration(elapsedMs)
  // Other end reasons retain elapsed time; only stops and failure replace it.
  const label = stopped ? t('message.stopped')
    : reason === 'error' ? t('message.turnProcess.failed')
      : duration === undefined ? t('message.turnProcess.worked')
        : t('message.turnProcess.took')
  const announcement = turnEndAnnouncement(reason, t)
  const status = <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
  // dshfiles (unslop T10): a failed Turn stays open and its failure card says "This turn failed" right below, so a
  // "Failed" heading that folds nothing only repeats it. The announcement stays for screen readers.
  if (reason === 'error') return status
  return (
    <>
      {status}
      <button
        ref={rowRef}
        type="button"
        className={css.root}
        data-entering={entering || undefined}
        data-open={open || undefined}
        data-turn-process={node.data.turn}
        data-turn-process-messages={node.data.messageCount}
        data-turn-process-tool-calls={node.data.toolCallCount}
        data-turn-process-subagents={node.data.subagentCount}
        disabled={!canCollapse}
        aria-expanded={turnProcess.hasContent ? open : undefined}
        onClick={(event) => {
          event.currentTarget.focus()
          turnProcess.setOpen(!open)
        }}
      >
        <span className={css.label}>
          {label}
          {duration?.map((part, index) => (
            <span key={index} className={part.numeric ? css.durationNumber : undefined}>{part.text}</span>
          ))}
        </span>
        {canCollapse && <ChevronDownIcon size={14} strokeWidth={1.5} className={css.chevron} />}
      </button>
    </>
  )
})
