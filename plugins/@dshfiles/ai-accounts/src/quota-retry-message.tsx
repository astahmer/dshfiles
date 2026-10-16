import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { aiAccountsKeys } from './accounts-queries.js'
import { aiAccountsApi, type QuotaRecoveryModelCatalog, type QuotaRecoveryModelSelection } from './api.js'
import { suggestedQuotaRecoverySelection } from './quota-recovery-selection.js'
import { usePreferences } from './use-preferences.js'

const EXHAUSTED_CODES: ReadonlySet<string> = new Set([
  'QUOTA',
  'ACCOUNT_QUOTA',
  'QUOTA_EXCEEDED',
  'ACCOUNT_QUOTA_EXCEEDED',
  'INSUFFICIENT_QUOTA',
  'USAGE_LIMIT_REACHED',
])
const EXHAUSTED_MESSAGE = /quota exceeded|(?:spend|usage) limit(?: reached| exhausted)?|no quota left|insufficient quota/i
const PROVIDER_DEFAULT_EFFORT = '__provider_default__'
type ModelCatalog = QuotaRecoveryModelCatalog
type ModelSelection = QuotaRecoveryModelSelection

const isQuotaExhausted = (failure: { readonly code: string; readonly message: string }): boolean =>
  EXHAUSTED_CODES.has(failure.code) || EXHAUSTED_MESSAGE.test(`${failure.code} ${failure.message}`)

const resetLabel = (timestamp: number): string => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)

const useContinuations = () => {
  const accounts = useApi(aiAccountsApi)
  return useQuery({
    queryKey: aiAccountsKeys.quotaContinuations,
    queryFn: ({ signal }) => accounts.quotaContinuations(undefined, { signal }),
    retry: false,
    // This notice appears on the turn that just failed, after the Host stored the
    // recovery, so a continuations page cached before that write must never decide
    // whether the inline controls render.
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

const modelFor = (catalog: ModelCatalog | undefined, selection: ModelSelection) =>
  catalog?.groups.find(group => group.id === selection.provider)?.models.find(model => model.id === selection.model)

const selectionForModel = (provider: string, model: NonNullable<ReturnType<typeof modelFor>>): ModelSelection => {
  const selection: ModelSelection = { provider, model: model.id }
  if (model.reasoning?.defaultEffort !== undefined) selection.reasoningEffort = model.reasoning.defaultEffort
  return selection
}

export const QuotaRetryMessage = (props: { readonly turn: TurnLocation; readonly sessionId: string }): JSX.Element | null => {
  const end = props.turn.end
  if (end?.data.reason.kind !== 'error' || !isQuotaExhausted(end.data.reason.error)) return null
  return <QuotaRetryMessageContent sessionId={props.sessionId} />
}

const QuotaRetryMessageContent = (props: { readonly sessionId: string }): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const preferences = usePreferences()
  const queryClient = useQueryClient()
  const continuationsQuery = useContinuations()
  const continuation = continuationsQuery.data?.continuations.find(item => item.sessionId === props.sessionId && item.state === 'waiting')
  const catalogQuery = useQuery({
    queryKey: ['ai-accounts', 'quota-recovery-model-catalog'],
    queryFn: ({ signal }) => accounts.quotaRecoveryModelCatalog(undefined, { signal }),
    enabled: continuation !== undefined,
    retry: false,
  })
  const [selectionOverride, setSelectionOverride] = useState<ModelSelection | null>(null)
  const [showSelector, setShowSelector] = useState(false)
  const selection =
    selectionOverride ??
    (continuation === undefined || catalogQuery.data === undefined
      ? undefined
      : suggestedQuotaRecoverySelection(catalogQuery.data, {
          provider: continuation.failedProvider,
          model: continuation.failedModel,
        }))
  const activeModel = selection === undefined ? undefined : modelFor(catalogQuery.data, selection)
  const selectedProvider = catalogQuery.data?.groups.find(group => group.id === selection?.provider)
  const resume = useMutation({
    mutationFn: async () => {
      if (continuation === undefined) throw new Error('Quota recovery is not available.')
      const input = selection === undefined ? { continuationId: continuation.continuationId } : { continuationId: continuation.continuationId, selection }
      const result = await accounts.resumeQuotaContinuation(input)
      if (!result.accepted) throw new Error('Quota recovery is no longer waiting.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiAccountsKeys.quotaContinuations }),
  })
  const updateRetry = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (continuation === undefined) throw new Error('Quota recovery is not available.')
      const result = await accounts.setQuotaContinuationAutoRetry({ continuationId: continuation.continuationId, sessionId: props.sessionId, enabled })
      if (!result.updated) throw new Error('Quota recovery is no longer waiting.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiAccountsKeys.quotaContinuations }),
  })
  const showChoice = preferences.showQuotaRetryChoice && !preferences.failureRecovery.exhausted.failover
  if (!showChoice) return null

  const knownReset = continuation !== undefined && continuation.resetAt !== null
  const exhaustedStatus = knownReset
    ? `Your current account's usage limit is exhausted. It resets ${resetLabel(continuation.resetAt ?? 0)}.`
    : "Your current account's usage limit is exhausted. Reset time is unknown; automatic retry is unavailable."
  const pendingStatus = continuationsQuery.isFetching
    ? 'Quota exhausted. Recovery details are loading.'
    : 'Quota exhausted. Reset details are unavailable; retry manually.'
  const recoveryStatus = continuation === undefined ? pendingStatus : exhaustedStatus
  const status = continuationsQuery.isError ? 'Quota exhausted. Retry when your provider limit resets.' : recoveryStatus
  const busy = resume.isPending || updateRetry.isPending

  return (
    <div className="dshx-root dshx:@container dshx:mt-2 dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-warning/40 dshx:bg-warning/10 dshx:px-3 dshx:py-2.5">
      <p className="dshx:text-sm dshx:text-foreground" role="status">
        {status}
      </p>
      {continuation === undefined || continuationsQuery.isError ? null : (
        <>
          <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
            <Checkbox checked={continuation.autoRetry} disabled={!knownReset || busy} onCheckedChange={checked => updateRetry.mutate(checked === true)} />
            <span>Automatically resume 1 minute after reset</span>
          </label>
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <Button
              disabled={busy || catalogQuery.isFetching || catalogQuery.data === undefined}
              onClick={() => setShowSelector(value => !value)}
              size="xs"
              type="button"
              variant="outline"
            >
              {showSelector ? 'Hide model options' : 'Resume with another model'}
            </Button>
            {catalogQuery.isError ? <span className="dshx:text-xs dshx:text-muted-foreground">Model options are unavailable.</span> : null}
          </div>
          {showSelector && selection !== undefined && catalogQuery.data !== undefined ? (
            <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:p-2.5">
              <div className="dshx:grid dshx:grid-cols-1 dshx:gap-2 dshx:@max-pane-compact:grid-cols-2">
                <Select
                  onValueChange={provider => {
                    const nextGroup = catalogQuery.data.groups.find(group => group.id === provider)
                    const nextModel = nextGroup?.models[0]
                    if (nextModel === undefined) return
                    setSelectionOverride(selectionForModel(provider, nextModel))
                  }}
                  value={selection.provider}
                >
                  <SelectTrigger aria-label="Provider or account">
                    <SelectValue placeholder="Provider or account" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogQuery.data.groups.map(group => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  onValueChange={modelId => {
                    const model = selectedProvider?.models.find(item => item.id === modelId)
                    if (model !== undefined) {
                      setSelectionOverride(selectionForModel(selection.provider, model))
                    }
                  }}
                  value={selection.model}
                >
                  <SelectTrigger aria-label="Model">
                    <SelectValue placeholder="Model" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedProvider?.models.map(model => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {activeModel?.reasoning?.efforts.length ? (
                <Select
                  onValueChange={effort => {
                    const nextSelection: ModelSelection = { provider: selection.provider, model: selection.model }
                    if (effort !== PROVIDER_DEFAULT_EFFORT) nextSelection.reasoningEffort = effort
                    setSelectionOverride(nextSelection)
                  }}
                  value={selection.reasoningEffort ?? PROVIDER_DEFAULT_EFFORT}
                >
                  <SelectTrigger aria-label="Reasoning effort">
                    <SelectValue placeholder="Reasoning effort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PROVIDER_DEFAULT_EFFORT}>Provider default</SelectItem>
                    {activeModel.reasoning.efforts.map(effort => (
                      <SelectItem key={effort.id} value={effort.id}>
                        {effort.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                <Button disabled={busy} onClick={() => resume.mutate()} size="xs" type="button">
                  {resume.isPending ? 'Queueing…' : 'Resume with this selection'}
                </Button>
                <span className="dshx:text-xs dshx:text-muted-foreground">This selects the Session’s next route and updates the default for new Sessions.</span>
              </div>
            </div>
          ) : null}
        </>
      )}
      {resume.isError || updateRetry.isError ? (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          Could not update quota recovery. Refresh the AI Accounts panel and try again.
        </p>
      ) : null}
    </div>
  )
}
