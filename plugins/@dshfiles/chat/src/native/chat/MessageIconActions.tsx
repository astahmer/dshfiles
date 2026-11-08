// Shared IconActions chrome for user and assistant messages: copy
// live, quote into the composer, optional branch wiring, and an optional
// date-aware clock.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  IconBranchOutlineRegular, IconCheckOutlineRegular, IconCopyOutlineRegular, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Composer, useContract } from '@dshfiles/dshx/client'
import { TextQuoteIcon } from '@dshfiles/plugin-ui/icons'
import { MessageQuote, quoteScopeFor, selectedQuoteText } from '../../message-quote.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatMessageClock } from './message-chrome.ts'
import { useCalendarDay } from './use-calendar-day.ts'
import css from './MessageIconActions.module.css'

export interface MessageIconActionsProps {
  /** Plain text the copy action writes. */
  text: string
  /** Unix epoch ms for the clock label; omitted for transient messages. */
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
  /**
   * Quote this message into the composer draft. `author` is who wrote it; `scope` says where its rendered text
   * lives so a selection inside it quotes only the selected part. Omission hides the action.
   */
  quote?: { readonly author: 'user' | 'assistant'; readonly turn?: number | undefined } | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Quote action: inserts the message (or the selection inside it) as a Markdown blockquote with a source line at the
 * composer caret, then focuses the composer. Nothing is sent. Hidden while no composer provides dshx `Composer`.
 */
function QuoteAction({ text, time, quote, t, day }: {
  text: string
  time: number | undefined
  quote: NonNullable<MessageIconActionsProps['quote']>
  t: ChatViewSlotProps['t']
  day: ReturnType<typeof useCalendarDay>
}) {
  const composer = useContract(Composer)
  const button = useRef<HTMLButtonElement>(null)
  // The selection is read on pointerdown: on touch devices the tap itself collapses it before click.
  const selected = useRef<string | undefined>(undefined)
  const capture = useCallback(() => {
    const actions = button.current?.parentElement
    selected.current = actions === null || actions === undefined
      ? undefined
      : selectedQuoteText(window.getSelection(), quoteScopeFor(actions, quote.author === 'user' ? 'row' : 'turn-assistant'))
  }, [quote.author])
  const onQuote = useCallback(() => {
    if (composer.status !== 'active') return
    const service = composer.value
    const source = selected.current ?? text
    selected.current = undefined
    const block = MessageQuote.format(source, {
      author: t(quote.author === 'user' ? 'message.quote.authorUser' : 'message.quote.authorAssistant'),
      turn: quote.turn,
      clock: time === undefined ? undefined : formatMessageClock(time, t, day),
    }, { turn: turn => t('message.quote.turn', { turn }) })
    if (block === undefined) return
    const inserted = service.insert({ text: MessageQuote.separatorBefore(service.text() ?? '') + block })
    if (inserted) service.focus()
  }, [composer, day, quote.author, quote.turn, t, text, time])
  if (composer.status !== 'active' || text.trim() === '') return null
  return (
    <Tooltip label={t('message.quote')} side="bottom">
      <button
        ref={button}
        type="button"
        className={css.action}
        aria-label={t('message.quote')}
        data-message-quote={quote.author}
        onPointerDown={capture}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') capture() }}
        onClick={onQuote}
      >
        <TextQuoteIcon />
      </button>
    </Tooltip>
  )
}

/**
 * Copy / branch (/ clock) IconActions row shared by user and assistant chrome.
 * @param props - Copy text, event time, clock side, branch callback, className.
 * @returns The actions row element.
 */
export function MessageIconActions({
  text, time, clock, onBranch, branchUnavailable = false, className,
  extraActions, usageAction, quote, t,
}: MessageIconActionsProps) {
  const day = useCalendarDay()
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
  const clockEl = time === undefined ? null : (
    <span className={clock === 'start' ? css.timeStart : css.timeEnd}>
      {formatMessageClock(time, t, day)}
    </span>
  )
  return (
    <div className={className === undefined ? css.actions : `${css.actions} ${className}`} data-clock={clock}>
      {clock === 'start' ? clockEl : null}
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button type="button" className={css.action} aria-label={copied ? t('copied') : t('copy')} onClick={onCopy}>
          {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
        </button>
      </Tooltip>
      {quote !== undefined && <QuoteAction text={text} time={time} quote={quote} t={t} day={day} />}
      {extraActions}
      {onBranch !== undefined && (
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
            <IconBranchOutlineRegular />
          </button>
        </Tooltip>
      )}
      {onBranch !== undefined && branchUnavailable && (
        <span id={reasonId} className={css.visuallyHidden}>{t('message.branchUnavailable')}</span>
      )}
      {clock === 'end'
        ? <span className={css.endInfo}>{usageAction}{clockEl}</span>
        : usageAction}
    </div>
  )
}
