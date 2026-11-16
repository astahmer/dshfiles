import { useApi, useResource } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import { ATTENTION_LIST_LIMIT, ATTENTION_READ, attentionApi, type AttentionItem } from './attention-api.js'
import type { InboxTranslate } from './inbox-locales.js'
import { INBOX_CHIP } from './triage-stage.js'
import { InboxView } from './inbox-view.js'

const Question = (props: { readonly item: AttentionItem; readonly t: InboxTranslate }): JSX.Element => {
  const { item, t } = props
  const api = useApi(attentionApi)
  const text = InboxView.textOf(item)
  const answer = useMutation({
    mutationFn: (choiceId: string) => runHostRequest({ request: signal => api.act({ id: item.id, verb: 'Answer', choiceId }, { signal }) }),
  })
  const refusal = answer.error !== null ? errorMessage(answer.error, t('actionFailed')) : answer.data?.ok === false ? answer.data.message : null
  return (
    <section
      data-thread-question={item.id}
      aria-label={text.reason}
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background dshx:px-3 dshx:py-2"
    >
      <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2">
        <StatusGlyph status="needs-you" label={t('severityBlocking')} className="dshx:mt-0.5 dshx:shrink-0" />
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
          <p className="dshx:m-0 dshx:line-clamp-3 dshx:text-sm dshx:font-medium dshx:break-words dshx:text-foreground">{text.reason}</p>
          {text.detail === null ? null : <p className="dshx:m-0 dshx:line-clamp-2 dshx:text-xs dshx:break-words dshx:text-muted-foreground">{text.detail}</p>}
        </div>
      </div>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:pl-6">
        {item.choices.map(choice => (
          <Button
            key={choice.id}
            size="sm"
            variant={choice.recommended === true ? 'default' : 'outline'}
            className={`dshx:max-w-full dshx:shrink ${INBOX_CHIP}`}
            disabled={answer.isPending || answer.data?.ok === true}
            onClick={() => answer.mutate(choice.id)}
          >
            <span className="dshx:truncate">{choice.label}</span>
            {choice.recommended === true ? <span className="dshx:sr-only"> ({t('recommended')})</span> : null}
          </Button>
        ))}
      </div>
      {answer.data?.ok === true ? (
        <p role="status" className="dshx:m-0 dshx:pl-6 dshx:text-xs dshx:text-muted-foreground">
          {answer.data.message}
        </p>
      ) : null}
      {refusal === null ? null : (
        <p role="alert" className="dshx:m-0 dshx:pl-6 dshx:text-xs dshx:text-destructive">
          {refusal}
        </p>
      )}
    </section>
  )
}

/**
 * The questions waiting on this thread that the thread does not show itself (a subagent's question), above its
 * composer with their options. "Answer" on a thread row opens the thread: this is the answerable card it lands on.
 * It reads the same Needs you list as the Inbox badge, so an answer given anywhere removes the strip everywhere.
 */
export const ThreadQuestionDock = (props: { readonly sessionId: string; readonly t: InboxTranslate }): JSX.Element | null => {
  const needsYou = useResource(attentionApi, 'list', { view: 'needs-you', limit: ATTENTION_LIST_LIMIT }, ATTENTION_READ)
  const questions = InboxView.threadQuestions(needsYou.data?.items ?? [], props.sessionId)
  if (questions.length === 0) return null
  return (
    // The dock is full width: sit on the composer card's column, as the other strips above it do.
    <div
      className="dshx-root dshx:mx-auto dshx:flex dshx:w-[calc(100%-var(--dsh-composer-side-clearance,0px)*2)] dshx:max-w-(--dsh-composer-card-max-width) dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:pb-2"
      data-thread-questions=""
    >
      {questions.map(item => (
        <Question key={item.id} item={item} t={props.t} />
      ))}
    </div>
  )
}
