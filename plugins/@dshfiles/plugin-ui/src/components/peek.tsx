import * as React from 'react'
import { cn } from '../lib/utils.js'
import type { LastReplyState } from '../hooks/last-reply.js'
import { LastReplyModel } from '../hooks/last-reply.js'
import { Button } from './ui/button.js'
import { KeyHint } from './ui/kbd.js'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover.js'
import { Spinner } from './ui/spinner.js'
import { StatusGlyph, type StatusGlyphState } from './work-status.js'

export interface PeekChoice {
  readonly id: string
  readonly label: string
  readonly recommended?: boolean
}

export interface PeekCardProps {
  readonly title: string
  readonly status?: StatusGlyphState
  readonly statusLabel?: string
  /** The thread's latest reply; absent for a subject that is not a thread. */
  readonly reply?: LastReplyState
  /** A pending question answerable in place: its text and choices; `1`–`9` pick a choice while the peek is open. */
  readonly question?: {
    readonly text: string
    readonly choices: readonly PeekChoice[]
    readonly busy?: boolean
    readonly onAnswer: (choiceId: string) => void
  }
  /** Short fact lines: what changed, whether it can land. */
  readonly facts?: readonly string[]
  readonly actions?: React.ReactNode
  readonly labels: {
    readonly lastReply: string
    readonly noReply: string
    readonly loading: string
    readonly close: string
  }
}

/** The body of a Space peek: what the row would show if you opened it, without leaving the list. */
export const PeekCard = (props: PeekCardProps): React.JSX.Element => {
  const reply = props.reply
  return (
    <div data-slot="peek-card" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:text-sm">
      <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2">
        {props.status === undefined ? null : (
          <StatusGlyph status={props.status} className="dshx:mt-0.5" {...(props.statusLabel === undefined ? {} : { label: props.statusLabel })} />
        )}
        <span className="dshx:min-w-0 dshx:flex-1 dshx:font-semibold dshx:break-words">{props.title}</span>
      </div>
      {props.question === undefined ? null : (
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          <p className="dshx:break-words dshx:text-foreground">{props.question.text}</p>
          {props.question.choices.length === 0 ? null : (
            <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
              {props.question.choices.slice(0, 9).map((choice, index) => (
                <Button
                  key={choice.id}
                  size="sm"
                  variant={choice.recommended === true ? 'default' : 'outline'}
                  className="dshx:max-w-full dshx:shrink"
                  disabled={props.question?.busy === true}
                  onClick={() => props.question?.onAnswer(choice.id)}
                >
                  <KeyHint keys={String(index + 1)} className="dshx:opacity-70" />
                  <span className="dshx:truncate">{choice.label}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
      {reply === undefined || reply.status === 'idle' ? null : (
        <section aria-label={props.labels.lastReply} className="dshx:flex dshx:flex-col dshx:gap-1">
          <span className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{props.labels.lastReply}</span>
          {reply.status === 'loading' ? (
            <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-muted-foreground">
              <Spinner />
              {props.labels.loading}
            </span>
          ) : reply.status === 'failed' ? (
            <span className="dshx:text-muted-foreground">{reply.message}</span>
          ) : reply.text === '' ? (
            <span className="dshx:text-muted-foreground">{props.labels.noReply}</span>
          ) : (
            <p data-peek-reply="" className="dshx:max-h-40 dshx:overflow-y-auto dshx:break-words dshx:whitespace-pre-wrap dshx:text-foreground">
              {LastReplyModel.lastParagraph(reply.text)}
            </p>
          )}
        </section>
      )}
      {props.facts === undefined || props.facts.length === 0 ? null : (
        <ul className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">
          {props.facts.map(fact => (
            <li key={fact} className="dshx:break-words">
              {fact}
            </li>
          ))}
        </ul>
      )}
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        {props.actions}
        <span className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
          <KeyHint keys="Space" />
          {props.labels.close}
        </span>
      </div>
    </div>
  )
}

/**
 * A peek popover anchored to a list row. Not modal: focus stays on the row so J/K keep moving and Space closes it; a
 * click outside or Escape closes it too.
 */
export const RowPeek = (props: {
  readonly anchor: HTMLElement | null
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly children: React.ReactNode
  readonly className?: string
  /** Where it opens beside the row: `right` of a narrow sidebar row, `bottom` under a full-width page row. */
  readonly side?: 'right' | 'bottom'
}): React.JSX.Element | null => {
  const anchorRef = React.useRef<HTMLElement | null>(null)
  anchorRef.current = props.anchor
  if (props.anchor === null) return null
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      <PopoverAnchor virtualRef={anchorRef as React.RefObject<HTMLElement>} />
      <PopoverContent
        data-row-peek=""
        side={props.side ?? 'right'}
        align="start"
        collisionPadding={12}
        className={cn('dshx-root dshx:w-80 dshx:max-w-[calc(100vw-1.5rem)]', props.className)}
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
      >
        {props.children}
      </PopoverContent>
    </Popover>
  )
}
