// Shared IconActions chrome for user and assistant messages: copy
// live, optional branch wiring, and an optional date-aware clock.
//
// dshfiles (productivity pass T1.5): a reply's row is copy plus one `⋯` menu holding the rest (feedback, Trace, branch,
// usage); times leave the row for the transcript's time dividers (TimeDivider.tsx), so `time` only feeds an accessible
// label and the `clock` side keeps the row's layout.

import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { CheckIcon, CopyIcon, EllipsisIcon, GitBranchIcon } from '@dshfiles/plugin-ui/icons'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './MessageIconActions.module.css'

export interface MessageIconActionsProps {
  /** Plain text the copy action writes. */
  text: string
  /** Unix epoch ms of the message; dshfiles: the time shows in the transcript's time dividers, not on the row. */
  time?: number | undefined
  /** Clock before icons (user) or after (assistant). */
  clock: 'start' | 'end'
  /** Fork the session at this message; omission hides the branch action. */
  onBranch?: (() => void) | undefined
  /** The message is not a completed transcript tail, so branch stays visible but unavailable. */
  branchUnavailable?: boolean | undefined
  /** Parent layout class composed onto the actions row. */
  className?: string | undefined
  /**
   * Slot-rendered actions owned by independent plugins, placed between the
   * built-in copy and branch controls.
   */
  extraActions?: ReactNode
  /**
   * Icon-row Turn-usage trigger (the TurnUsagePanel pill), seated after the
   * branch control at the end of the icon cluster.
   */
  usageAction?: ReactNode
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Copy / branch (/ clock) IconActions row shared by user and assistant chrome.
 * @param props - Copy text, event time, clock side, branch callback, className.
 * @returns The actions row element.
 */
export function MessageIconActions({
  text, clock, onBranch, branchUnavailable = false, className,
  extraActions, usageAction, t,
}: MessageIconActionsProps) {
  const reasonId = useId()
  // Same success chrome as CodeBlock: a short check swap after the write,
  // gated so re-clicks during the window neither re-copy nor stack timers.
  const [copied, setCopied] = useState(false)
  const copyPending = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyEpoch = useRef(0)
  useEffect(() => () => {
    copyEpoch.current += 1
    copyPending.current = false
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])
  const onCopy = useCallback(() => {
    if (copied || copyPending.current) return
    const epoch = copyEpoch.current
    copyPending.current = true
    void writeClipboard(text).then((ok) => {
      if (epoch !== copyEpoch.current) return
      copyPending.current = false
      if (!ok) return
      setCopied(true)
      copyTimer.current = setTimeout(() => {
        copyTimer.current = null
        setCopied(false)
      }, 1000)
    })
  }, [copied, text])
  const more = clock === 'end' && (extraActions != null || onBranch !== undefined || usageAction != null)
  // dshfiles (b:ysaj): inside the ⋯ menu the branch verb is a labelled row like the plugins' rows (Trace, Add to
  // backlog, Restore), not a bare icon in a line of mixed icons and words.
  const branch = onBranch !== undefined && (
        <Tooltip label={branchUnavailable ? t('message.branchUnavailable') : t('message.branch')} side="bottom">
          {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
          <button
            type="button"
            className={css.action}
            aria-label={t('message.branch')}
            aria-disabled={branchUnavailable || undefined}
            aria-describedby={branchUnavailable ? reasonId : undefined}
            data-unavailable={branchUnavailable || undefined}
            onClick={branchUnavailable ? undefined : onBranch}
          >
            <GitBranchIcon size={14} strokeWidth={1.5} />
            {more ? <span>{t('message.branch')}</span> : null}
          </button>
        </Tooltip>
  )
  return (
    <div className={className === undefined ? css.actions : `${css.actions} ${className}`} data-clock={clock}>
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button type="button" className={css.action} aria-label={copied ? t('copied') : t('copy')} onClick={onCopy}>
          {copied ? <CheckIcon size={14} strokeWidth={1.5} /> : <CopyIcon size={14} strokeWidth={1.5} />}
        </button>
      </Tooltip>
      {more
        ? (
          <Popover>
            <Tooltip label={t('message.more')} side="bottom">
              <PopoverTrigger asChild>
                <button type="button" className={css.action} aria-label={t('message.more')}>
                  <EllipsisIcon size={14} strokeWidth={1.5} />
                </button>
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent side="bottom" align="start" className={`dshx-root ${css.menu}`}>
              <div className={css.menuRow} data-message-actions-menu role="group" aria-label={t('message.more')}>
                {extraActions}
                {branch}
                {usageAction}
              </div>
            </PopoverContent>
          </Popover>
        )
        : <>{extraActions}{branch}{usageAction}</>}
      {onBranch !== undefined && branchUnavailable && (
        <span id={reasonId} className={css.visuallyHidden}>{t('message.branchUnavailable')}</span>
      )}
    </div>
  )
}
