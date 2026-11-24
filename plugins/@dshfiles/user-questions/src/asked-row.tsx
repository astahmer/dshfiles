import type { ComponentProps } from 'react'
import { DisclosureRow } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-user-questions/types'
import { replyPairsOf, type QuestionReplyAnswer } from './native/question-reply.ts'
import { parseRecommendedLabel } from './native/QuestionComposer.tsx'
import { askedRowView } from './asked-row-view.ts'

/**
 * The transcript row of an `ask_user_question` call (unslop round three, item 24): one line, `Asked · {header}` while
 * the question is open and `Asked · {header} · {answer}` once answered. It replaces core's row, which drew the call's
 * JSON while its arguments streamed and a "waiting · Answer" line above the card that already asks.
 */

/** The question glyph core's tool rows draw, at their 16px size. */
const QuestionGlyph = (): JSX.Element => (
  <svg aria-hidden viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
    <circle cx="8" cy="8" r="6.4" />
    <path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.65c-.5.22-.8.6-.8 1.1v.35" />
    <circle cx="8" cy="11.2" r=".2" fill="currentColor" />
  </svg>
)

/** The result's text when it records answers; a timed call's `pending` placeholder and failures record none. */
const recordedAnswers = (props: ToolCallViewProps): readonly QuestionReplyAnswer[] | undefined => {
  if (props.phase !== 'result' || props.block.isError) return undefined
  const text = props.block.content.flatMap(content => (content.type === 'text' ? [content.text] : [])).join('\n')
  if (text === '' || /"pending"\s*:\s*true/.test(text)) return undefined
  return replyPairsOf(text).answers
}

/** Panel verbs for the row's own Session, from this plugin's `userQuestionPanels`. */
export interface AskedRowInjected {
  /**
   * Put the call's question card back in the composer.
   * @param callId - the row's own call.
   * @returns whether the call still had a card to show.
   */
  readonly revealPanel: (callId: string) => boolean
}

export type AskedRowProps = ToolCallViewProps & PropsLocale<'question'> & InjectFace<AskedRowInjected>

export const AskedRow = (props: AskedRowProps) => {
  const call = props.phase === 'preparing' ? undefined : props.phase === 'result' ? props.block.call : props.block
  const answerable = props.useProjection('userQuestions', view => view?.active.some(row => row.callId === props.callId) ?? false)
  const settled = props.useProjection('userQuestions', view => view?.settled.find(row => row.callId === props.callId))
  const code = props.phase === 'result' ? props.block.error?.code : undefined
  const view = askedRowView({
    argsRaw: call?.argsRaw,
    answers: settled?.answers ?? recordedAnswers(props),
    cancelled: code === 'ASK_CANCELLED',
    t: key => props.t(key),
    optionLabel: label => parseRecommendedLabel(label).label,
  })
  const disclosure = props.useDisclosure()
  /** The native row names its visible header through `title`; that is a heading, not hover help. */
  const rowProps: ComponentProps<typeof DisclosureRow> = {
    icon: <QuestionGlyph />,
    title: view.title,
    open: disclosure.expanded,
    expandable: view.questions.length > 0 || answerable,
    onToggle: disclosure.toggle,
    running: false,
  }
  return (
    <div className="dshx-root" data-asked-row="" data-answerable={answerable ? '' : undefined}>
      <DisclosureRow {...rowProps}>
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:p-3 dshx:text-sm">
          {view.questions.map(item => (
            <div key={item.question} className="dshx:flex dshx:min-w-0 dshx:flex-col">
              <span className="dshx:break-words">{item.question}</span>
              {item.answer === undefined ? null : <span className="dshx:break-words dshx:text-muted-foreground">{item.answer}</span>}
            </div>
          ))}
          <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
            {answerable ? (
              <button
                type="button"
                className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:rounded-md dshx:border dshx:border-border dshx:px-2 dshx:text-xs dshx:hover:bg-accent dshx:pointer-coarse:h-11"
                onClick={() => { props.revealPanel(props.callId) }}
              >
                {props.t('row.show')}
              </button>
            ) : null}
            {props.inspect === undefined ? null : (
              <button
                type="button"
                className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:rounded-md dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:hover:bg-accent dshx:pointer-coarse:h-11"
                onClick={props.inspect}
              >
                {props.t('row.inspect')}
              </button>
            )}
          </div>
        </div>
      </DisclosureRow>
    </div>
  )
}
