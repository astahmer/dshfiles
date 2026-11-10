import { useMemo, useSyncExternalStore } from 'react'
import {
  Button, extractMarkdownPlainText, IconEditOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PendingQuestion, PlanReview, QuestionComposerProps } from './contract/slots.ts'
import css from './PlanReviewPanel.module.css'

/** The panel's own props: the question domain face, the narrowed review, and the locale seat. */
export type PlanReviewPanelProps =
  { pending: PendingQuestion; review: PlanReview } & Pick<QuestionComposerProps, 't' | 'renderSlot'>

/**
 * Optional-prop spread for a decision button's tooltip: `title` is optional on
 * the DOM props, and exactOptionalPropertyTypes rejects an explicit undefined.
 *
 * @param description - the asker's option description, when it carries one.
 * @returns The `title` prop to spread, or nothing.
 */
function tooltip(description: string | undefined): { title?: string } {
  return description === undefined ? {} : { title: description }
}

/**
 * Render plan review controls; the submitted document opens in the sidebar.
 *
 * @param props - the question domain face, the narrowed plan review, and `t`.
 * @returns The plan-review takeover for this request.
 */
export function PlanReviewPanel({ pending, review, t, renderSlot }: PlanReviewPanelProps) {
  // Decisions are recorded on the carrier, so a second presentation of this card
  // renders the same in-flight, failed or sent controls.
  const submission = useSyncExternalStore(pending.subscribe, pending.snapshot).submission
  const settling = submission.kind === 'submitting' || submission.kind === 'sent'
  const error = submission.kind !== 'failed' ? null
    : submission.reason === 'error' ? submission.message
      : t(submission.reason === 'sent' ? 'status.sent' : 'error.resubmit')
  const decide = (label: string): void => {
    void pending.submit({ answers: [{ id: review.id, selected: [label] }] })
  }
  const summary = useMemo(() => {
    const title = extractMarkdownPlainText(review.plan, { mode: 'first-line' })
    const description = extractMarkdownPlainText(review.plan, { mode: 'first-paragraph' })
    return { title, description: description === title ? '' : description }
  }, [review.plan])

  return (
    <div className={css.frame} data-plan-review-key={pending.key}>
      <section className={css.card} aria-label={review.question} aria-busy={settling}>
        <div className={css.strip}>
          <StateDot state={settling ? 'ongoing' : 'warning'} />
          {t('plan.header')}
          <div className={css.previewActions}>
            {renderSlot('conversation.plan-review.actions', { review, requestKey: pending.key })}
          </div>
        </div>
        <div className={css.summary}>
          <h3 className={css.title}>{summary.title}</h3>
          {summary.description !== '' && <p className={css.description}>{summary.description}</p>}
        </div>
        <div className={css.footer}>
          <div className={css.feedback} role="status">{error}</div>
          <div className={css.actions}>
            <Button
              variant="outline" className={css.discuss} icon={<IconEditOutlineRegular size={14} />}
              disabled={settling} onClick={() => { void pending.dismiss() }}
            >
              {t('plan.discuss')}
            </Button>
            <Button
              variant="primary" {...tooltip(review.approve.description)}
              disabled={settling} onClick={() => { decide(review.approve.label) }}
            >
              {t('plan.approve')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
