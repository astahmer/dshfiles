import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useApi, useApiEvent } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { KeyRoundIcon } from '@dshfiles/plugin-ui/icons'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { secretRequestsApi, type secretRequestViewSchema } from './api.js'
import { JevChatTurnTimeline } from './jev-chat-turn-timeline.js'
import type { SecretCatalogTranslate } from './locales.js'
import { SecretSetupForm } from './secret-setup-form.js'
import { SecretSetupSteps, type SecretSetupStep } from './secret-setup-step.js'

type SecretRequestView = typeof secretRequestViewSchema.Type

const pendingKey = (sessionId: string) => ['secret-catalog', 'requests', sessionId] as const
// Requests belong to the turn whose tool call is waiting, which is always the Session's latest one.
const requestTurns = new JevChatTurnTimeline()

type Answer = { readonly kind: 'stored'; readonly reference: string } | { readonly kind: 'declined' }

/** Asking, typing the value, or told the request is gone; a lost request can never show the form again. */
type CardPhase = 'asking' | 'editing' | 'lost'

const RequestCard = (props: {
  readonly request: SecretRequestView
  readonly t: SecretCatalogTranslate
  readonly onAnswered: (answer: Answer) => void
}): JSX.Element => {
  const api = useApi(secretRequestsApi)
  const [phase, setPhase] = useState<CardPhase>('asking')
  const [step, setStep] = useState<SecretSetupStep>(SecretSetupSteps.draft)
  const decline = useMutation({
    mutationFn: () => api.decline({ requestId: props.request.requestId }),
    onSuccess: () => props.onAnswered({ kind: 'declined' }),
    onError: () => setPhase('lost'),
  })
  const t = props.t
  return (
    <section
      aria-label={t('requestCardLabel', { alias: props.request.alias })}
      className="dshx-root dshx:@container dshx:mt-3 dshx:flex dshx:max-w-xl dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:p-3"
      data-testid="secret-request-card"
    >
      <div className="dshx:flex dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-2">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-start dshx:gap-2">
          <KeyRoundIcon aria-hidden="true" className="dshx:mt-0.5 dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
            <h3 className="dshx:text-sm dshx:font-semibold">{t('requestTitle')}</h3>
            <p className="dshx:text-xs dshx:text-muted-foreground">{t('requestPrivacy')}</p>
          </div>
        </div>
        <div className="dshx:flex dshx:flex-wrap dshx:gap-1">
          <Badge className="dshx:font-mono" variant="secondary">
            {props.request.alias}
          </Badge>
          <Badge variant="outline">{props.request.environment}</Badge>
          <Badge variant="outline">{props.request.scope}</Badge>
        </div>
      </div>
      <figure className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:border-l-2 dshx:border-border dshx:pl-2">
        <figcaption className="dshx:text-xs dshx:text-muted-foreground">{t('requestPurpose')}</figcaption>
        <blockquote className="dshx:text-sm dshx:break-words">{props.request.purpose}</blockquote>
      </figure>
      {phase === 'lost' ? (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          {t('requestLost')}
        </p>
      ) : null}
      {phase === 'editing' ? (
        <SecretSetupForm
          onBind={async reference => {
            try {
              await api.complete({ requestId: props.request.requestId, reference })
            } catch (error) {
              setPhase('lost')
              throw error
            }
          }}
          onBound={reference => props.onAnswered({ kind: 'stored', reference })}
          onCancel={() => setPhase('asking')}
          onStepChange={setStep}
          step={step}
          t={t}
          target={{ cwd: props.request.cwd, suggestedAlias: props.request.alias, environment: props.request.environment, scope: props.request.scope }}
        />
      ) : (
        <div className="dshx:flex dshx:flex-wrap dshx:justify-end dshx:gap-2">
          <Button disabled={decline.isPending} onClick={() => decline.mutate()} size="sm" type="button" variant="ghost">
            {decline.isPending ? t('requestDeclining') : t('requestDecline')}
          </Button>
          <Button
            disabled={decline.isPending}
            onClick={() => {
              setStep(SecretSetupSteps.draft())
              setPhase('editing')
            }}
            size="sm"
            type="button"
          >
            {t('requestEnterValue')}
          </Button>
        </div>
      )}
    </section>
  )
}

/**
 * Secrets an Agent of this Session is waiting for (`request_secret`), on the Session's latest turn. The value is typed
 * into the Catalog's masked form and stored on the Host; the waiting tool call receives only the reference.
 */
export const SecretRequestCards = (props: {
  readonly sessionId: string
  readonly turn: TurnLocation
  readonly t: SecretCatalogTranslate
}): JSX.Element | null => {
  const api = useApi(secretRequestsApi)
  const queryClient = useQueryClient()
  const [answers, setAnswers] = useState<Readonly<Record<string, Answer>>>({})
  useLayoutEffect(() => {
    requestTurns.publish(props.sessionId, props.turn.turn)
  }, [props.sessionId, props.turn.turn])
  const isLatestTurn = useSyncExternalStore(
    requestTurns.subscribe,
    () => requestTurns.isLatest(props.sessionId, props.turn.turn),
    () => false,
  )
  const eventStatus = useApiEvent(secretRequestsApi, 'changed', () => void queryClient.invalidateQueries({ queryKey: pendingKey(props.sessionId) }))
  const pending = useQuery({
    queryKey: pendingKey(props.sessionId),
    enabled: isLatestTurn,
    queryFn: ({ signal }) => api.pending({ sessionId: props.sessionId }, { signal }),
    // The changed event keeps the list current; polling only covers a disconnected event stream.
    refetchInterval: eventStatus === 'live' ? false : 5_000,
    retry: false,
  })
  if (!isLatestTurn) return null
  const requests = pending.data?.requests ?? []
  const answered = Object.entries(answers)
  if (requests.length === 0 && answered.length === 0) return null
  return (
    <div className="dshx-root dshx:flex dshx:flex-col" data-testid="secret-request-cards">
      {answered.map(([requestId, answer]) => (
        <p className="dshx:mt-3 dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground" key={requestId} role="status">
          <KeyRoundIcon aria-hidden="true" className="dshx:size-4" />
          {answer.kind === 'stored' ? props.t('requestStored', { reference: answer.reference }) : props.t('requestDeclined')}
        </p>
      ))}
      {requests
        .filter(request => answers[request.requestId] === undefined)
        .map(request => (
          <RequestCard
            key={request.requestId}
            onAnswered={answer => {
              setAnswers(current => ({ ...current, [request.requestId]: answer }))
              void queryClient.invalidateQueries({ queryKey: pendingKey(props.sessionId) }).catch(() => undefined)
            }}
            request={request}
            t={props.t}
          />
        ))}
    </div>
  )
}
