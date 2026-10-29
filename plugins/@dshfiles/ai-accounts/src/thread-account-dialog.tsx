import { useState, type ReactNode } from 'react'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { ArrowLeftRightIcon, LoaderCircleIcon, Minimize2Icon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { threadAccountApi } from './thread-account-api.js'

/** Key this presentation-only scope by session identity so changing threads discards the open account choice. */
export const ThreadAccountSurface = (props: {
  readonly sessionId: string | null
  readonly children: (choose: ((instanceId: string) => void) | undefined) => ReactNode
}): JSX.Element => {
  const [choice, setChoice] = useState<string | null>(null)
  return (
    <>
      {props.children(props.sessionId === null ? undefined : setChoice)}
      {props.sessionId === null || choice === null ? null : (
        <ThreadAccountDialog key={`${props.sessionId}:${choice}`} sessionId={props.sessionId} instanceId={choice} close={() => setChoice(null)} />
      )}
    </>
  )
}

/** The immutable dialog key captures one thread and account; server revision checks reject a stale confirmation. */
const ThreadAccountDialog = (props: { readonly sessionId: string; readonly instanceId: string; readonly close: () => void }): JSX.Element => {
  const api = useApi(threadAccountApi)
  const preview = useQuery({
    queryKey: ['ai-accounts', 'thread-switch', props.sessionId, props.instanceId],
    queryFn: ({ signal }) => api.preview({ sessionId: props.sessionId, instanceId: props.instanceId }, { signal }),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const switching = useMutation({
    mutationFn: async () => {
      const plan = preview.data
      if (plan === undefined || preview.isError || preview.isFetching) throw new Error('Refresh and review the account and model before switching.')
      return api.switch({ sessionId: props.sessionId, instanceId: props.instanceId, expectedRevision: plan.expectedRevision, target: plan.target })
    },
    onError: () => {
      void preview.refetch()
    },
  })
  const plan = preview.data
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !switching.isPending) props.close()
      }}
    >
      <DialogContent
        className="dshx-root dshx:max-w-md"
        onEscapeKeyDown={event => {
          if (switching.isPending) event.preventDefault()
        }}
        onPointerDownOutside={event => {
          if (switching.isPending) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{switching.isSuccess ? 'Thread account changed' : 'Use account for this thread'}</DialogTitle>
          <DialogDescription>
            {switching.isSuccess
              ? 'Upcoming requests target the selected account. An in-flight request, other threads and your default model are unchanged. Your configured recovery still applies if this account cannot serve.'
              : 'Keep this conversation and change only the account used for its next request. No message is sent automatically.'}
          </DialogDescription>
        </DialogHeader>
        {preview.isPending ? (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
            <LoaderCircleIcon className="dshx:size-4 dshx:animate-spin" />
            Checking available models…
          </p>
        ) : null}
        {plan === undefined ? null : (
          <>
            <dl className="dshx:grid dshx:grid-cols-[auto_minmax(0,1fr)] dshx:gap-x-4 dshx:gap-y-2 dshx:text-sm">
              <dt className="dshx:text-muted-foreground">Account</dt>
              <dd className="dshx:min-w-0 dshx:break-words dshx:font-medium">{plan.displayName}</dd>
              <dt className="dshx:text-muted-foreground">Model</dt>
              <dd className="dshx:min-w-0 dshx:break-words dshx:font-medium">{plan.modelName}</dd>
            </dl>
            <p className="dshx:text-sm dshx:text-muted-foreground">
              {plan.strategy === 'same-model'
                ? 'Same model retained. Compatible reasoning effort is kept; otherwise this account’s reasoning default applies.'
                : plan.strategy === 'default-model'
                  ? 'Your current model is unavailable here. This account supports your deployment’s default model, shown above.'
                  : 'Your current and deployment-default models are unavailable here. The first model in this account’s preferred order is shown above.'}
            </p>
            {plan.context?.suggestCompaction === true ? (
              <Alert>
                <Minimize2Icon className="dshx:size-4" />
                <AlertTitle>Consider compacting this long conversation</AlertTitle>
                <AlertDescription className="dshx:space-y-2">
                  <p>
                    Estimated current context: ~{Math.round(plan.context.estimatedTokens).toLocaleString()} tokens
                    {plan.context.targetWindow === null ? '' : `; target window: ${plan.context.targetWindow.toLocaleString()}`}. A new account may not share
                    the previous account’s prompt cache.
                  </p>
                  <p>
                    Compaction can reduce future input, but summarizing costs tokens and can omit details. The transcript stays available. No savings are
                    guaranteed.
                  </p>
                  <p>
                    This account switch does not compact the conversation. Native automatic-compaction settings still apply to later requests. Use the existing{' '}
                    <code>/compact</code> command when you choose. Native compaction may use the configured summarizer or the previous request’s account, not
                    necessarily the account selected here.
                  </p>
                </AlertDescription>
              </Alert>
            ) : null}
            {plan.running && !switching.isSuccess ? (
              <p role="status" className="dshx:text-sm dshx:text-muted-foreground">
                An in-flight request keeps its account. This selection applies from the next request; running work is not interrupted.
              </p>
            ) : null}
          </>
        )}
        {preview.isError || switching.isError ? (
          <p role="alert" className="dshx:text-sm dshx:text-destructive">
            {errorMessage(switching.error ?? preview.error, 'Account switching is unavailable. The Host may need updating; no new request was started.')}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={switching.isPending} onClick={props.close}>
            {switching.isSuccess ? 'Done' : 'Cancel'}
          </Button>
          {switching.isSuccess ? null : (
            <Button disabled={plan === undefined || preview.isError || preview.isFetching || switching.isPending} onClick={() => switching.mutate()}>
              {switching.isPending ? <LoaderCircleIcon className="dshx:size-4 dshx:animate-spin" /> : <ArrowLeftRightIcon className="dshx:size-4" />}Use this
              account
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
