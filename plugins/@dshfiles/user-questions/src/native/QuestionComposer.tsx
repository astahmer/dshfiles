import {
  useEffect, useMemo, useRef, useState,
  type ChangeEvent, type FocusEvent, type KeyboardEvent,
} from 'react'
import clsx from 'clsx'
import {
  Button, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular, IconChevronUpOutlineRegular, IconCloseOutlineRegular,
  IconEditOutlineRegular, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  planReviewOf, type QuestionAnswer, type QuestionCardSnapshot, type QuestionComposerProps, type QuestionSubmission,
} from './contract/slots.ts'
import type { PendingQuestion } from './contract/slots.ts'
import type { QuestionDraftAnswer, QuestionDraftProgress } from './draft-store.ts'
import { PlanReviewPanel } from './PlanReviewPanel.tsx'
import { QuestionMarkdownText } from '../rich/question-markdown.ts'
import { OptionDescription, QuestionMarkdown, QuestionTitle } from '../rich/QuestionMarkdown.tsx'
import css from './QuestionComposer.module.css'

/**
 * Displayed feedback: validation feedback is stored as a dictionary KEY and
 * translated at render, so already-shown feedback follows a locale switch;
 * runtime failure messages (finished strings from the wire) pass through
 * verbatim.
 */
type Feedback = { key: 'error.incomplete' | 'error.unanswered' | 'error.unavailable' | 'error.resubmit' | 'status.sent' } | { text: string }

/** A removed card can remain mounted until the composer seat updates. */
const REMOVED_CARD: QuestionCardSnapshot = {
  state: 'open',
  phase: { kind: 'closed' },
  submission: { kind: 'idle' },
  waitState: 'counting',
  countdown: undefined,
  channel: 'none',
  closed: true,
}

/**
 * Translate a recorded attempt into displayed feedback; only failures show.
 * @param submission - the card's single answer attempt.
 * @returns the feedback to render, or null while nothing failed.
 */
const submissionFeedback = (submission: QuestionSubmission): Feedback | null => {
  if (submission.kind !== 'failed') return null
  if (submission.reason === 'error') return { text: submission.message }
  return { key: submission.reason === 'sent' ? 'status.sent' : 'error.resubmit' }
}

/**
 * Split the conventional recommendation suffix without changing the answer value.
 * @param label - Original option label returned if selected.
 * @returns Display label plus recommendation state.
 */
export function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}

/** Only a marked first choice is an implicit draft; the user still submits it. */
function recommendedFirstOption(question: PendingQuestion['questions'][number]): string | undefined {
  const label = question.options?.[0]?.label
  return label !== undefined && parseRecommendedLabel(label).recommended ? label : undefined
}

/** Accept persisted progress only when it still describes this question batch. */
function isQuestionDraftProgress(value: unknown, questionCount: number): value is QuestionDraftProgress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const progress = value as Record<string, unknown>
  if (typeof progress.index !== 'number' || !Number.isInteger(progress.index)
    || progress.index < 0 || progress.index >= questionCount
    || !Array.isArray(progress.drafts) || progress.drafts.length !== questionCount
    || (progress.wait !== undefined && progress.wait !== 'editing' && progress.wait !== 'waiting')) return false
  return progress.drafts.every((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const draft = item as Record<string, unknown>
    return Array.isArray(draft.selected) && draft.selected.every((label: unknown) => typeof label === 'string')
      && typeof draft.custom === 'string' && typeof draft.skipped === 'boolean'
  })
}

/** Return whether a text-field key event belongs to an active IME composition. */
function isComposing(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
  return event.nativeEvent.isComposing || Reflect.get(event.nativeEvent, 'keyCode') === 229
}

/** The free-text answer field shared by both question variants. */
interface AnswerFieldProps {
  /** Visual variant: the custom row's inline column or the optionless question's framed block. */
  variant: 'inline' | 'block'
  /** Current draft text. */
  value: string
  /** Empty-field prompt. */
  placeholder: string
  /** Whether a submission in flight has frozen the field. */
  disabled: boolean
  /** Whether this field takes focus on mount. */
  autoFocus?: boolean
  /** Called when the field takes focus. */
  onFocus?: () => void
  /** Called with each edit of the draft. */
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  /** Called with each key press, before the browser's own handling. */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

/**
 * Auto-growing free-text answer: a textarea, so a long answer soft-wraps and
 * Shift+Enter breaks a line, over a hidden mirror that owns the height.
 *
 * The mirror renders the draft plus a trailing newline in normal flow and so
 * sizes the grid row (counting rows by '\n' cannot see soft wraps); the
 * textarea shares that one cell and stretches to it, and `rows={1}` keeps the
 * control's own intrinsic height out of the row sizing so the mirror alone
 * decides. Past the mirror's cap the textarea scrolls itself — it is the only
 * scrollport in the stack, there being no second glyph layer to keep aligned.
 * Mirror and textarea MUST share font, line-height, padding and wrapping rules
 * or the two heights diverge.
 *
 * @param props - visual variant, draft text, and the field's event handlers.
 * @returns The mirrored auto-growing field.
 */
function AnswerField(props: AnswerFieldProps) {
  return (
    <div className={clsx(css.field, props.variant === 'inline' ? css.customInline : css.customBlock)}>
      <div aria-hidden className={css.fieldMirror}>{`${props.value}\n`}</div>
      <textarea
        autoFocus={props.autoFocus}
        className={css.fieldInput}
        value={props.value}
        disabled={props.disabled}
        rows={1}
        placeholder={props.placeholder}
        onFocus={props.onFocus}
        onChange={props.onChange}
        onKeyDown={props.onKeyDown}
      />
    </div>
  )
}

/**
 * Composer takeover router. Generic-question drafts live in this entry's
 * Session-scoped Slot store, keyed by the pending carrier, so a strict Session
 * entry remount restores the same request without exposing it to another one.
 *
 * One takeover, two presentations: a request that declares a presentation intent this
 * package renders uses that presentation (a plan review is one decision over one
 * plan, not a question set), and every other request takes the generic flow.
 * The routing lives here, at the one entry that owns the composer seat, so
 * neither presentation can claim a request the other is already rendering.
 *
 * @param props - the selector-matched pending question carrier plus the framework standard kit.
 * @returns The question flow, or the intent's own surface, for this request.
 */
export function QuestionComposer(props: QuestionComposerProps) {
  const question = props.matched
  const review = useMemo(() => planReviewOf(question.questions), [question])
  return review === undefined
    ? (
      <QuestionFlow
        key={question.key}
        pending={question}
        t={props.t}
        useStore={props.useStore}
        useQuestionCard={props.useQuestionCard}
        actions={props.actions}
      />
    )
    : <PlanReviewPanel key={question.key} pending={question} review={review} t={props.t} renderSlot={props.renderSlot} />
}

type QuestionFlowProps =
  { pending: PendingQuestion } & Pick<QuestionComposerProps, 't' | 'useStore' | 'useQuestionCard' | 'actions'>

function QuestionFlow({ pending, t, useStore, useQuestionCard, actions }: QuestionFlowProps) {
  const questions = pending.questions
  // A read-only card built from a settled call's transcript: the same panel
  // over the recorded answers, with nothing left to submit.
  const review = pending.review
  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: { codeLabel: t('codeBlock.title'), wrapLabel: t('codeBlock.wrap'), unwrapLabel: t('codeBlock.unwrap') } },
    footnotes: t('markdown.footnotes'),
  }), [t])
  const initialDrafts = useMemo<QuestionDraftAnswer[]>(() => {
    // Recorded answers echo the question ids rather than their order.
    const recorded = new Map((review ?? []).map(answer => [answer.id, answer]))
    return questions.map((item) => {
      const answer = recorded.get(item.id)
      const custom = answer?.custom ?? ''
      const recommended = review === undefined ? recommendedFirstOption(item) : undefined
      return {
        selected: answer === undefined && recommended !== undefined ? [recommended] : [...answer?.selected ?? []],
        custom,
        // A recorded answer with no selection and no custom text was skipped.
        skipped: answer !== undefined && answer.selected.length === 0 && custom === '',
      }
    })
  }, [questions, review])
  const stored = useStore(state => state.progressByRequest[pending.key])
  const validStored = isQuestionDraftProgress(stored, questions.length) ? stored : undefined
  // A review card renders the record itself, so a draft its live card left
  // behind can never surface as an answer; only the page position is restored.
  const storedProgress = review === undefined ? validStored : undefined
  const index = validStored?.index ?? 0
  const drafts = storedProgress?.drafts ?? initialDrafts
  const restoredWait = storedProgress?.wait
    ?? (storedProgress?.drafts.some((item, itemIndex) =>
      item.selected.length !== initialDrafts[itemIndex]?.selected.length
      || item.selected.some((label, labelIndex) => label !== initialDrafts[itemIndex]?.selected[labelIndex])
      || item.custom !== '' || item.skipped) === true
      ? 'editing' : undefined)
  const [validation, setValidation] = useState<Feedback | null>(null)
  const card = useQuestionCard(pending.key, snapshot => snapshot ?? REMOVED_CARD)
  const canSubmit = card.channel !== 'none'
  const submission = card.submission
  const submitting = submission.kind === 'submitting' || submission.kind === 'sent'
  const answering = submitting && submission.intent === 'answer'
  const feedback = submissionFeedback(submission) ?? validation
  // The answer surface freezes while a submission is in flight, and for good on
  // a review card: its call has already settled.
  const locked = submitting || review !== undefined
  useEffect(() => {
    if (card.closed) actions.clear(pending.key)
  }, [actions, card.closed, pending.key])
  useEffect(() => {
    actions.prune(pending.liveKeys())
  }, [actions, pending])
  useEffect(() => {
    if (restoredWait === 'waiting') pending.takeTime()
    if (restoredWait === 'editing') pending.engage()
  }, [pending, restoredWait])
  // The countdown belongs to the carrier, not to this component: the user can
  // close the panel and reopen it from the tool call row, and a timer that died
  // with the mount would leave the tool call waiting past its deadline.
  const countdown = card.countdown
  // Collapsed to the header strip so the conversation above stays readable
  // while the user decides; answer drafts live in the Session store above.
  const [minimized, setMinimized] = useState(false)
  // The free-form textarea autofocuses on first presentation; re-expanding a
  // collapsed question must not steal focus from the expand toggle back into
  // the input, so focus is granted once per question index.
  const focusedQuestions = useRef(new Set<number>())
  const answerSurface = useRef<HTMLDivElement>(null)
  // Every navigation write stays in bounds and drafts mirrors questions 1:1.
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const question = questions[index]!
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const draft = drafts[index]!
  const hasOptions = (question.options?.length ?? 0) > 0
  const { title: questionTitle, body: questionBody } = useMemo(() => QuestionMarkdownText.parts(question.question), [question.question])

  const waitChoice = (): 'editing' | 'waiting' | undefined => {
    const { kind } = pending.snapshot().phase
    return kind === 'editing' ? 'editing' : kind === 'waiting' ? 'waiting' : undefined
  }

  const replaceProgress = (nextIndex: number, nextDrafts: QuestionDraftAnswer[]): void => {
    const wait = waitChoice()
    actions.replace(pending.key, {
      index: nextIndex,
      drafts: nextDrafts,
      ...(wait === undefined ? {} : { wait }),
    })
  }

  const clearFeedback = (): void => {
    setValidation(null)
    pending.resetSubmission()
  }

  const takeTime = (): void => {
    pending.takeTime()
    replaceProgress(index, drafts)
  }

  const focusAnswerSurface = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) pending.holdFocus()
  }

  const blurAnswerSurface = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) pending.releaseFocus()
  }

  useEffect(() => {
    const release = (): void => { pending.releaseFocus() }
    const refocus = (): void => {
      if (pending.snapshot().phase.kind === 'editing') {
        pending.engage()
        return
      }
      if (answerSurface.current?.contains(document.activeElement) === true) pending.holdFocus()
    }
    const visibilityChanged = (): void => { if (document.hidden) release(); else refocus() }
    window.addEventListener('blur', release)
    window.addEventListener('focus', refocus)
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      release()
      window.removeEventListener('blur', release)
      window.removeEventListener('focus', refocus)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [pending])

  const dismissFlow = (): void => {
    // A tool-call-keyed panel only leaves the seat; nothing is sent and nothing
    // is persisted, and the tool call row brings it back.
    if (pending.dismissal === 'hide') {
      void pending.dismiss()
      return
    }
    if (!canSubmit) {
      setValidation({ key: 'error.unavailable' })
      return
    }
    clearFeedback()
    void pending.cancel()
  }

  const updateDraft = (
    update: (current: QuestionDraftAnswer) => QuestionDraftAnswer,
    nextIndex = index,
  ): void => {
    pending.engage()
    const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index ? update(item) : item)
    replaceProgress(nextIndex, nextDrafts)
    clearFeedback()
  }

  const choose = (label: string): void => {
    updateDraft((current) => {
      if (question.multiSelect === true) {
        const selected = current.selected.includes(label)
          ? current.selected.filter(item => item !== label)
          : [...current.selected, label]
        return { ...current, selected, skipped: false }
      }
      return { selected: [label], custom: '', skipped: false }
    }, question.multiSelect !== true && index < questions.length - 1 ? index + 1 : index)
  }

  const answered = (item: QuestionDraftAnswer): boolean =>
    item.selected.length > 0 || item.custom.trim() !== ''

  const completed = (item: QuestionDraftAnswer): boolean => answered(item) || item.skipped

  const submitDrafts = (values: QuestionDraftAnswer[]): void => {
    const missing = values.findIndex(item => !completed(item))
    if (missing >= 0) {
      replaceProgress(missing, values)
      setValidation({ key: 'error.incomplete' })
      return
    }
    if (!canSubmit) {
      setValidation({ key: 'error.unavailable' })
      return
    }
    const answer: QuestionAnswer = {
      answers: questions.map((item, itemIndex) => {
        const value = values[itemIndex] as QuestionDraftAnswer
        if (value.skipped) return { id: item.id, selected: [] }
        const custom = value.custom.trim()
        return {
          id: item.id,
          selected: custom === '' || item.multiSelect === true ? value.selected : [],
          ...(custom === '' ? {} : { custom }),
        }
      }),
    }
    clearFeedback()
    void pending.submit(answer)
  }

  const continueFlow = (): void => {
    if (!answered(draft)) {
      setValidation({ key: 'error.unanswered' })
      return
    }
    if (index < questions.length - 1) {
      replaceProgress(index + 1, drafts)
      clearFeedback()
      return
    }
    submitDrafts(drafts)
  }

  // Shared by the inline custom field and the optionless one: a multi-select
  // draft retains checked labels, while a single-select custom answer replaces
  // its selection. Enter continues the flow, Shift+Enter breaks a line.
  const draftCustom = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value
    updateDraft(current => ({
      ...current,
      selected: question.multiSelect === true ? current.selected : [],
      custom: value,
      skipped: false,
    }))
  }

  const continueFromCustom = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
    event.preventDefault()
    continueFlow()
  }

  const skipQuestion = (): void => {
    pending.engage()
    const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index
      ? { selected: [], custom: '', skipped: true }
      : item)
    replaceProgress(index < questions.length - 1 ? index + 1 : index, nextDrafts)
    clearFeedback()
    if (index < questions.length - 1) {
      return
    }
    submitDrafts(nextDrafts)
  }

  return (
    <div className={css.frame} data-question-key={pending.key}>
      <section
        className={clsx(css.card, minimized && css.cardMinimized, questionBody !== '' && css.cardRich)}
        aria-labelledby={`question-${pending.key}-${String(index)}`}
      >
        <header className={css.header}>
          <div className={css.headingBlock}>
            {question.header !== undefined && <div className={css.eyebrow}>{question.header}</div>}
            {/* Owned delta: the question is markdown. Its first paragraph is the heading; an untitled question (it
                opens with an image or a fence) keeps an accessible heading from its header. */}
            {questionTitle === undefined
              ? <h2 className={css.srOnly} id={`question-${pending.key}-${String(index)}`}>{question.header ?? QuestionMarkdownText.plainText(question.question)}</h2>
              : <QuestionTitle className={css.title} id={`question-${pending.key}-${String(index)}`} text={questionTitle} labels={markdownLabels} />}
          </div>
          <div className={css.headerActions}>
            {countdown !== undefined && card.waitState !== 'waiting' && card.waitState !== 'editing' && card.waitState !== 'continued' && (
              <span className={css.waitStatus}>
                {t(countdown.running ? 'wait.countdown' : 'wait.paused', {
                  seconds: Math.ceil(countdown.remainingMs / 1000),
                })}
              </span>
            )}
            {countdown !== undefined && card.waitState !== 'waiting' && card.waitState !== 'editing' && card.waitState !== 'continued' && (
              <Button variant="outline" className={css.waitButton} onClick={takeTime}>
                {t('wait.takeTime')}
              </Button>
            )}
            {card.state === 'continued' && <span className={css.waitStatus}>{t('wait.continued')}</span>}
            {/* A held or frozen countdown says so; a request that never carried
                one waits silently, as the blocking question always has. */}
            {countdown !== undefined && (card.waitState === 'waiting' || card.waitState === 'editing') && (
              <span className={css.waitStatus}>{t('wait.held')}</span>
            )}
            {review !== undefined && <span className={css.waitStatus}>{t('review.status')}</span>}
            <button
              type="button" className={css.iconButton}
              aria-label={t(minimized ? 'nav.maximize' : 'nav.minimize')}
              title={t(minimized ? 'nav.maximize' : 'nav.minimize')}
              aria-expanded={!minimized}
              disabled={submitting}
              onClick={() => { setMinimized(current => !current) }}
            >
              {minimized ? <IconChevronUpOutlineRegular /> : <IconChevronDownOutlineRegular />}
            </button>
            <button
              type="button" className={css.iconButton}
              aria-label={t(pending.dismissal === 'hide' ? 'nav.close' : 'nav.cancel')}
              title={t(pending.dismissal === 'hide' ? 'nav.close' : 'nav.cancel')}
              disabled={submitting} onClick={dismissFlow}
            >
              <IconCloseOutlineRegular />
            </button>
          </div>
        </header>

        {!minimized && (
          <>
            <div
              ref={answerSurface}
              className={css.body}
              data-question-scroll
              onFocusCapture={focusAnswerSurface}
              onBlurCapture={blurAnswerSurface}
            >
              {questionBody !== '' && (
                <QuestionMarkdown text={questionBody} labels={markdownLabels} previewTitle={question.header ?? questionTitle ?? 'HTML preview'} />
              )}
              {question.detail !== undefined && (
                <div className={css.detail}><MarkdownText text={question.detail} labels={markdownLabels} /></div>
              )}
              <div className={css.options} role={question.multiSelect === true ? 'group' : 'radiogroup'}>
                {(question.options ?? []).map((option, optionIndex) => {
                  const selected = draft.selected.includes(option.label)
                  const display = parseRecommendedLabel(option.label)
                  // Owned delta: a markdown description renders under the button, so its links stay links.
                  const richDescription = option.description !== undefined && QuestionMarkdownText.hasSyntax(option.description)
                    ? option.description
                    : undefined
                  const descriptionId = `question-${pending.key}-${String(index)}-option-${String(optionIndex)}-description`
                  const row = (
                    <button
                      type="button" key={`${option.label}-${String(optionIndex)}`}
                      className={clsx(css.option, selected && question.multiSelect !== true && css.optionSelected)}
                      role={question.multiSelect === true ? 'checkbox' : 'radio'}
                      aria-checked={selected}
                      aria-label={display.label}
                      aria-describedby={richDescription === undefined ? undefined : descriptionId}
                      disabled={locked}
                      onClick={() => { choose(option.label) }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        submitDrafts(drafts)
                      }}
                    >
                      {question.multiSelect === true
                        ? (
                          <span className={clsx(css.checkbox, selected && css.checkboxChecked)} aria-hidden="true">
                            {selected && <IconCheckOutlineRegular size={12} />}
                          </span>
                        )
                        : <span className={css.number}>{optionIndex + 1}</span>}
                      <span className={css.optionCopy}>
                        <span className={css.optionLine}>
                          <span className={css.optionLabel}>{display.label}</span>
                          {display.recommended && (
                            <span className={css.badge}>{t('option.recommended')}</span>
                          )}
                          {option.description !== undefined && richDescription === undefined && (
                            <span className={css.description}>{option.description}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  )
                  if (richDescription === undefined) return row
                  return (
                    <div key={`${option.label}-${String(optionIndex)}`} className={css.optionItem}>
                      {row}
                      <OptionDescription
                        id={descriptionId}
                        text={richDescription}
                        labels={markdownLabels}
                        onSelect={locked ? undefined : () => { choose(option.label) }}
                      />
                    </div>
                  )
                })}

                {review !== undefined && draft.skipped && (
                  <p className={css.reviewNote}>{t('review.skipped')}</p>
                )}

                {/* A review card keeps the free-text field only when the
                    recorded answer used it; an empty disabled box with a
                    placeholder would read as somewhere to type. */}
                {(review === undefined || draft.custom !== '') && (hasOptions
                  ? (
                    <div
                      className={clsx(
                        css.customRow,
                        draft.custom !== '' && css.customRowActive,
                        question.multiSelect !== true && draft.selected.length > 0 && css.customRowYielded,
                      )}
                    >
                      {question.multiSelect === true
                        ? (
                          <span
                            className={clsx(css.checkbox, draft.custom !== '' && css.checkboxChecked)}
                            aria-hidden="true"
                          >
                            {draft.custom !== '' && <IconCheckOutlineRegular size={12} />}
                          </span>
                        )
                        : (
                          <span className={css.number} aria-hidden="true">
                            <IconEditOutlineRegular size={12} />
                          </span>
                        )}
                      <AnswerField
                        variant="inline"
                        value={draft.custom}
                        disabled={locked}
                        placeholder={t('custom.placeholder')}
                        onChange={draftCustom}
                        onKeyDown={continueFromCustom}
                      />
                    </div>
                  )
                  : (
                    <AnswerField
                      // A missing countdown does not imply an indefinite request:
                      // a timed request can still be awaiting its claim's first frame.
                      autoFocus={canSubmit && countdown === undefined && !locked && !focusedQuestions.current.has(index)}
                      variant="block"
                      value={draft.custom}
                      disabled={locked}
                      placeholder={t('custom.placeholder')}
                      onFocus={() => { focusedQuestions.current.add(index) }}
                      onChange={draftCustom}
                      onKeyDown={continueFromCustom}
                    />
                  ))}
              </div>
            </div>

            <footer className={css.footer}>
              <div className={css.pager}>
                <button
                  type="button" className={css.iconButton} aria-label={t('nav.prev')}
                  disabled={index === 0 || submitting}
                  onClick={() => { replaceProgress(index - 1, drafts); clearFeedback() }}
                >
                  <IconChevronLeftOutlineRegular />
                </button>
                <span className={css.progress}>{index + 1} / {questions.length}</span>
                <button
                  type="button" className={css.iconButton} aria-label={t('nav.next')}
                  disabled={index === questions.length - 1 || submitting}
                  onClick={() => { replaceProgress(index + 1, drafts); clearFeedback() }}
                >
                  <IconChevronRightOutlineRegular />
                </button>
              </div>
              <div className={css.feedback} role="status">
                {feedback === null ? null : 'key' in feedback ? t(feedback.key) : feedback.text}
              </div>
              {/* A review card has nothing to send: the pager alone walks the record. */}
              {review === undefined && (
                <div className={css.footerActions}>
                  <Button variant="outline" disabled={submitting} onClick={skipQuestion}>
                    {t('action.skip')}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={submitting || !answered(draft) || (index === questions.length - 1 && !canSubmit)}
                    onClick={continueFlow}
                  >
                    {answering
                      ? t('submitting')
                      : index === questions.length - 1 ? t('submit') : t('action.next')}
                  </Button>
                </div>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
