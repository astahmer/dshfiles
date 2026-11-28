import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { KeyHint } from '@dshfiles/plugin-ui/components/ui/kbd'
import type { LastReplyState } from '@dshfiles/plugin-ui/hooks/last-reply'
import { LastReplyModel } from '@dshfiles/plugin-ui/hooks/last-reply'
import { CheckIcon, ClockIcon, SkipForwardIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type * as React from 'react'
import type { AttentionItem } from './attention-api.js'
import type { InboxTranslate } from './inbox-locales.js'
import type { TriageAction } from './inbox-keys.js'

/** Phone verb chips: 44pt rows in the thumb zone (T6.1) with the 8px control radius (round five P2); a pointer keeps the compact buttons. */
export const INBOX_CHIP = 'dshx:pointer-coarse:h-11 dshx:pointer-coarse:rounded-lg dshx:pointer-coarse:px-4 dshx:pointer-coarse:text-sm'

export interface TriageBarProps {
  readonly t: InboxTranslate
  readonly index: number
  readonly total: number
  readonly item: AttentionItem
  /** Every way to act on the item, each once; the one marked primary runs on Enter. */
  readonly actions: readonly TriageAction[]
  /** What Open is called for this item: "Open thread", "Review thread" or the page a provider registered. */
  readonly openLabel: string
  readonly busy: boolean
  readonly error: string | null
  readonly onAction: (action: TriageAction) => void
  readonly onDone: () => void
  readonly onSnooze: () => void
  readonly onSkip: () => void
  readonly onExit: () => void
}

const actionLabel = (props: Pick<TriageBarProps, 't' | 'openLabel'>, action: TriageAction): string => {
  switch (action.kind) {
    case 'answer':
      return action.label
    case 'verb':
      return action.verb
    case 'land':
      return props.t('land')
    case 'review':
      return props.t('review')
    default:
      return props.openLabel
  }
}

const actionKey = (action: TriageAction): string =>
  action.kind === 'answer' ? `answer:${action.choiceId}` : action.kind === 'verb' ? action.verb : action.kind

/**
 * The one action row of an item in Triage: `2 of 5 · its answers or verb · Open · Done · Snooze · Skip · Exit`. The card
 * beside it shows the item only, so no verb appears twice. Every key is also a button, so a phone triages by touch; the
 * keycaps hide on a coarse pointer, where there are no keys. On a phone the bar sits under the card, at the bottom of
 * the screen (the thumb zone), with 48pt chips (T6.1).
 */
export const TriageBar = (props: TriageBarProps): React.JSX.Element => {
  const { t } = props
  const answers = props.actions.filter(action => action.kind === 'answer')
  return (
    <div
      data-triage-bar=""
      role="toolbar"
      aria-label={t('triage')}
      className="dshx:sticky dshx:top-0 dshx:z-10 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background dshx:p-2 dshx:shadow-s1 dshx:pointer-coarse:top-auto dshx:pointer-coarse:bottom-0 dshx:pointer-coarse:order-last dshx:pointer-coarse:mt-auto dshx:pointer-coarse:rounded-xl dshx:pointer-coarse:p-3"
    >
      <span data-triage-progress="" className="dshx:px-1 dshx:text-sm dshx:font-medium dshx:tabular-nums">
        {t('triageProgress', { index: props.index, total: props.total })}
      </span>
      {props.actions.map(action => {
        const digit = action.kind === 'answer' ? answers.indexOf(action) + 1 : 0
        return (
          <Button
            key={actionKey(action)}
            size="sm"
            variant={action.primary ? 'default' : action.kind === 'answer' ? 'outline' : 'ghost'}
            disabled={props.busy && action.kind !== 'open' && action.kind !== 'review'}
            data-triage-action={action.kind}
            onClick={() => props.onAction(action)}
            className={cn('dshx:max-w-full dshx:shrink', INBOX_CHIP, action.primary && 'dshx:pointer-coarse:basis-full')}
          >
            {action.primary ? <KeyHint keys="Enter" className="dshx:pointer-coarse:hidden" /> : null}
            {!action.primary && digit >= 1 && digit <= 9 ? <KeyHint keys={String(digit)} className="dshx:opacity-70 dshx:pointer-coarse:hidden" /> : null}
            <span className="dshx:truncate">{actionLabel(props, action)}</span>
            {action.kind === 'answer' && action.primary ? <span className="dshx:sr-only"> ({t('recommended')})</span> : null}
          </Button>
        )
      })}
      {props.item.verbs.includes('Done') ? (
        <Button size="sm" variant="outline" disabled={props.busy} className={INBOX_CHIP} onClick={props.onDone}>
          <CheckIcon aria-hidden className="dshx:pointer-fine:hidden" />
          <KeyHint keys="E" className="dshx:pointer-coarse:hidden" />
          {t('done')}
        </Button>
      ) : null}
      {props.item.verbs.includes('Snooze') ? (
        <Button size="sm" variant="outline" disabled={props.busy} className={INBOX_CHIP} onClick={props.onSnooze}>
          <ClockIcon aria-hidden className="dshx:pointer-fine:hidden" />
          <KeyHint keys="H" className="dshx:pointer-coarse:hidden" />
          {t('snooze')}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={props.busy} className={INBOX_CHIP} onClick={props.onSkip}>
        <SkipForwardIcon aria-hidden className="dshx:pointer-fine:hidden" />
        <KeyHint keys="S" className="dshx:pointer-coarse:hidden" />
        {t('triageSkip')}
      </Button>
      <Button size="sm" variant="ghost" className={cn('dshx:ml-auto', INBOX_CHIP)} onClick={props.onExit}>
        <XIcon aria-hidden className="dshx:pointer-fine:hidden" />
        <KeyHint keys="Escape" className="dshx:pointer-coarse:hidden" />
        {t('triageExit')}
      </Button>
      {props.actions.some(action => action.kind === 'land') ? (
        <span className="dshx:basis-full dshx:px-1 dshx:text-xs dshx:text-muted-foreground">{t('triageLandHint')}</span>
      ) : null}
      {props.error === null ? null : (
        <span role="alert" className="dshx:basis-full dshx:px-1 dshx:text-xs dshx:text-destructive">
          {props.error} {t('loadFailedHint')}
        </span>
      )}
    </div>
  )
}

const replyText = (t: InboxTranslate, reply: LastReplyState): string => {
  if (reply.status === 'loading') return t('peekLoading')
  if (reply.status === 'failed') return reply.message
  if (reply.status !== 'ready') return ''
  return reply.text === '' ? t('peekNoReply') : LastReplyModel.lastParagraph(reply.text, 900)
}

/** The thread's last reply under the item, so most items can be judged without opening the thread. */
export const TriageReply = (props: { readonly t: InboxTranslate; readonly reply: LastReplyState }): React.JSX.Element | null => {
  const reply = props.reply
  if (reply.status === 'idle') return null
  return (
    <section aria-label={props.t('peekLastReply')} className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-lg dshx:border dshx:border-border dshx:p-3">
      <span className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{props.t('peekLastReply')}</span>
      <p data-triage-reply="" className="dshx:max-w-[72ch] dshx:text-sm dshx:break-words dshx:whitespace-pre-wrap">
        {replyText(props.t, reply)}
      </p>
    </section>
  )
}

/** The end of a run: nothing left, how many were handled, and the way back. */
export const TriageZero = (props: { readonly t: InboxTranslate; readonly handled: number; readonly onBack: () => void }): React.JSX.Element => (
  <div
    data-triage-zero=""
    className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-border dshx:px-6 dshx:py-12 dshx:text-center"
  >
    <CheckIcon aria-hidden className="dshx:size-6 dshx:text-muted-foreground" />
    <h2 className="dshx:text-base dshx:font-semibold">{props.t('triageZeroTitle')}</h2>
    <p className="dshx:max-w-[48ch] dshx:text-sm dshx:text-muted-foreground">{props.t('triageZeroBody', { count: props.handled })}</p>
    <Button size="sm" variant="outline" onClick={props.onBack}>
      <KeyHint keys="Escape" className="dshx:pointer-coarse:hidden" />
      {props.t('triageZeroBack')}
    </Button>
  </div>
)
