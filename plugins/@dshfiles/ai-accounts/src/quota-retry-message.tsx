import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { aiAccountsKeys } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
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

const isQuotaExhausted = (failure: { readonly code: string; readonly message: string }): boolean =>
  EXHAUSTED_CODES.has(failure.code) || EXHAUSTED_MESSAGE.test(`${failure.code} ${failure.message}`)

const resetLabel = (timestamp: number): string => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)

export const QuotaRetryMessage = (props: { readonly turn: TurnLocation; readonly sessionId: string }): JSX.Element | null => {
  const end = props.turn.end
  if (end?.data.reason.kind !== 'error' || !isQuotaExhausted(end.data.reason.error)) return null
  return <QuotaRetryMessageContent sessionId={props.sessionId} />
}

const QuotaRetryMessageContent = (props: { readonly sessionId: string }): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const preferences = usePreferences()
  const queryClient = useQueryClient()
  const continuationsQuery = useQuery({
    queryKey: aiAccountsKeys.quotaContinuations,
    queryFn: ({ signal }) => accounts.quotaContinuations(undefined, { signal }),
    retry: false,
  })
  const continuation = continuationsQuery.data?.continuations.find(item => item.sessionId === props.sessionId && item.state === 'waiting')
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

  return (
    <div className="dshx-root dshx:mt-2 dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-warning/40 dshx:bg-warning/10 dshx:px-3 dshx:py-2.5">
      <p className="dshx:text-sm dshx:text-foreground" role="status">
        {status}
      </p>
      {continuation === undefined || continuationsQuery.isError ? null : (
        <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
          <Checkbox
            checked={continuation.autoRetry}
            disabled={!knownReset || updateRetry.isPending}
            onCheckedChange={checked => updateRetry.mutate(checked === true)}
          />
          <span>Automatically retry this turn after reset</span>
        </label>
      )}
      {updateRetry.isError ? (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          Could not update automatic retry. Refresh the AI Accounts panel and try again.
        </p>
      ) : null}
    </div>
  )
}
