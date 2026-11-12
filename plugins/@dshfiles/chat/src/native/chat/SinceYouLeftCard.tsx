/**
 * dshfiles (productivity pass T4.3): the "Since you left" divider and its one recap card, drawn above the first Turn
 * the user has not seen: "3 turns · 7 files +120 −14 · 1 failed · 1 question waiting", with chips that jump to each
 * failed or questioning Turn and to the Turn that wrote each file. Dismissible; never drawn for Turns already seen.
 */
import { createContext, memo, type ReactNode } from 'react'
import { XIcon } from '@dshfiles/plugin-ui/icons'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { RECAP_FILE_CHIPS, SinceYouLeftRecapModel, type SinceYouLeftRecap } from './since-you-left.ts'
import css from './SinceYouLeftCard.module.css'

/** Where ChatFlow inserts the divider: before the row with this render key. */
export interface SinceYouLeftPlacement {
  readonly beforeKey: string
  readonly element: ReactNode
  /**
   * When an unread thread opens at its final answer (upstream's unread landing), the divider and recap ride at the top
   * of that Turn's answer row instead, so the landing shows them first and they are the only divider. The flow keeps
   * `beforeKey` as the fallback while no answer row of this Turn is mounted.
   */
  readonly answerTurn?: number | undefined
}

export const SinceYouLeftContext = createContext<SinceYouLeftPlacement | null>(null)

export interface SinceYouLeftCardProps {
  readonly recap: SinceYouLeftRecap
  readonly onJump: (turn: number) => void
  readonly onDismiss: () => void
  readonly t: ChatViewSlotProps['t']
}

export const SinceYouLeftCard = memo(function SinceYouLeftCard({ recap, onJump, onDismiss, t }: SinceYouLeftCardProps) {
  const parts: string[] = [recap.turns === 1 ? t('chat.since.turnsOne') : t('chat.since.turns', { count: recap.turns })]
  if (recap.fileCount > 0) {
    const files = recap.fileCount === 1 ? t('chat.since.filesOne') : t('chat.since.files', { count: recap.fileCount })
    parts.push(recap.added + recap.removed > 0 ? `${files} +${String(recap.added)} −${String(recap.removed)}` : files)
  }
  if (recap.failedTurns.length > 0) parts.push(t('chat.since.failed', { count: recap.failedTurns.length }))
  if (recap.questionsWaiting > 0)
    parts.push(recap.questionsWaiting === 1 ? t('chat.since.questionWaiting', { count: 1 }) : t('chat.since.questionsWaiting', { count: recap.questionsWaiting }))
  else if (recap.questionTurns.length > 0) parts.push(t('chat.since.questions', { count: recap.questionTurns.length }))
  const chips = recap.files.slice(0, RECAP_FILE_CHIPS)
  const more = recap.fileCount - chips.length
  return (
    <section className={css.root} data-since-you-left="" aria-label={t('chat.since.label')}>
      <div className={css.divider} role="separator" aria-label={t('chat.since.divider')}>
        <span className={css.dividerLabel}>{t('chat.since.divider')}</span>
      </div>
      <div className={css.card}>
        <div className={css.head}>
          <p className={css.summary}>{parts.join(' · ')}</p>
          <button type="button" className={css.dismiss} aria-label={t('chat.since.dismiss')} onClick={onDismiss}>
            <XIcon size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        {(recap.failedTurns.length > 0 || recap.questionTurns.length > 0 || chips.length > 0) && (
          <div className={css.chips}>
            {recap.failedTurns.map(turn => (
              <button key={`failed-${String(turn)}`} type="button" className={css.chip} data-tone="danger" onClick={() => onJump(turn)}>
                {t('chat.turnMap.kind.failed')} · {t('chat.since.jump', { turn })}
              </button>
            ))}
            {recap.questionTurns.map(turn => (
              <button key={`question-${String(turn)}`} type="button" className={css.chip} data-tone="accent" onClick={() => onJump(turn)}>
                {t('chat.turnMap.kind.question')} · {t('chat.since.jump', { turn })}
              </button>
            ))}
            {chips.map(file => (
              <button key={file.path} type="button" className={css.chip} data-file-chip="" onClick={() => onJump(file.turn)}>
                <span className={css.fileName}>{SinceYouLeftRecapModel.fileName(file.path)}</span>
                {file.added + file.removed > 0 && (
                  <span className={css.lines}>
                    +{file.added} −{file.removed}
                  </span>
                )}
              </button>
            ))}
            {more > 0 && <span className={css.more}>+{more}</span>}
          </div>
        )}
      </div>
    </section>
  )
})
